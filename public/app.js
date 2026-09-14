/* app.js — shared helpers and report rendering.
   Used by index.html (live scan) and report.html (saved report), so a saved
   report looks identical to the one the person generated. */

/* ── PASTE YOUR GOOGLE PAGESPEED API KEY BETWEEN THE QUOTES ──
   The key is visible in page source. That is fine for a browser key ONLY if
   you restrict it in Google Cloud Console:
     Credentials > your key > Application restrictions > Websites
       > add  https://YOUR-SITE.netlify.app/*
   Restricted that way it only works when called from your own site.
   Leave empty and the performance section is skipped.                      */
const PSI_KEY = 'AIzaSyCl3aJfhKhNp6GAfKTeYx8PREHP5oBXa5I';

const AUDIT_ENDPOINT  = '/.netlify/functions/audit';
const PLACES_ENDPOINT = '/.netlify/functions/places';
const SAVE_ENDPOINT   = '/.netlify/functions/save';
const REPORT_ENDPOINT = '/.netlify/functions/report';

/* ── small helpers ── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})
  : '—';

const yn = (v, good='Yes', bad='No') => `<span class="${v?'yes':'no'}">${v?good:bad}</span>`;

function row(label, value){
  return `<div class="row"><span>${esc(label)}</span><span>${value}</span></div>`;
}

function band(n){ return n === null ? '' : n >= 90 ? 'good' : n >= 50 ? 'mid' : 'bad'; }
const pct = v => (typeof v === 'number' ? Math.round(v * 100) : null);

function verdict(total){
  if (total >= 90) return 'In good shape. The fixes below are refinements, not repairs.';
  if (total >= 80) return 'Solid foundation with a few gaps that are costing visibility.';
  if (total >= 70) return 'Working, but leaving real search traffic on the table.';
  if (total >= 55) return 'Several issues are actively holding this site back in search.';
  return 'This site needs attention. The items below are costing it customers.';
}

async function readJson(res, label){
  const text = await res.text();
  if (!text.trim()){
    if (res.status === 504 || res.status === 502)
      throw new Error(`That site took too long to respond and the ${label} timed out. Try again, or try the www version of the address.`);
    if (res.status === 404)
      throw new Error(`The ${label} service is not deployed. Check the Functions tab in Netlify.`);
    throw new Error('The server closed the connection without responding. Try again.');
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`The server returned an unexpected response (status ${res.status}).`); }
}

/* ── who ran the report ── */
function bylineHtml(author, savedAt){
  if (!author || !author.name) return '';
  const when = savedAt ? ` on ${new Date(savedAt).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}` : '';
  return `<div class="byline">
    <div>
      <div class="who">Prepared by ${esc(author.name)}${esc(when)}</div>
      ${author.email ? `<div class="contact">${esc(author.email)}</div>` : ''}
    </div>
    <div class="indep">Independent personal project. Not a GoDaddy product or endorsement.</div>
  </div>`;
}

/* ── the audit report body ──
   Structure is deliberate: conclusions first, raw data folded away. A customer
   should be able to read the top screen and know what to do. */

function glanceSay(area, score, max){
  const p = score / max;
  const map = {
    'Search visibility': ['Google can read this site well','Google is missing key signals','Google struggles to understand this site'],
    'Visitor experience': ['Visitors get a smooth experience','Some friction for visitors','Visitors hit real problems'],
    'Site freshness':     ['Updated recently','Going stale','Looks abandoned'],
    'Blog activity':      ['Publishing regularly','Slowing down','No active blog']
  };
  const opts = map[area] || ['Good','Needs work','Poor'];
  return p >= 0.8 ? opts[0] : p >= 0.5 ? opts[1] : opts[2];
}

function auditHtml(d){
  const s = d.score, seo = d.seo, ux = d.ux, fr = d.freshness, bl = d.blog;

  /* score meter */
  const segs = s.breakdown.map(b => {
    const p = Math.round((b.score / b.max) * 100);
    return {...b, pct:p, cls: p < 50 ? 'low' : p < 80 ? 'mid' : ''};
  });
  const segBars = segs.map(b =>
    `<div class="seg ${b.cls}" style="flex:${b.max}" title="${esc(b.area)}: ${b.score} of ${b.max}"><i style="width:${b.pct}%"></i></div>`).join('');
  const segLabels = segs.map(b =>
    `<div style="flex:${b.max}"><b>${b.score}/${b.max}</b>${esc(b.area)}</div>`).join('');

  /* at-a-glance cards */
  const glance = s.breakdown.map(b => {
    const p = b.score / b.max;
    const cls = p >= 0.8 ? 'good' : p >= 0.5 ? 'mid' : 'bad';
    return `<div class="gcard ${cls}">
      <div class="top"><span class="n">${b.score}</span><span class="max">of ${b.max}</span></div>
      <div class="area">${esc(b.area)}</div>
      <div class="say">${esc(glanceSay(b.area, b.score, b.max))}</div>
    </div>`;
  }).join('');

  /* headline: the three things that matter most */
  const crit = s.findings.filter(f => f.severity === 'critical');
  const top3 = (crit.length ? crit : s.findings).slice(0, 3);
  const takeaway = top3.length ? `
    <div class="takeaway${crit.length ? '' : ' ok'}">
      <h4>${crit.length ? 'Fix these first' : 'Worth improving'}</h4>
      <ol>${top3.map(f => `<li><b>${esc(f.label)}.</b> ${esc(f.detail)}</li>`).join('')}</ol>
    </div>` : '';

  /* full findings list, folded */
  const findingsHtml = s.findings.length
    ? s.findings.map(f => `<div class="finding ${f.severity}"><div class="tick"></div><div class="body">
        <div class="label">${esc(f.label)}</div>
        <div class="detail">${esc(f.detail)}</div>
        <div class="area">${esc(f.area)}</div></div></div>`).join('')
    : '<p class="clean">No issues flagged. That is rare.</p>';

  const posts = (bl.recentPosts && bl.recentPosts.length)
    ? `<ul class="posts">${bl.recentPosts.map(p =>
        `<li><span>${esc(p.title || 'Untitled post')}</span><time>${fmtDate(p.date)}</time></li>`).join('')}</ul>`
    : '';

  const fold = (title, count, inner, open) =>
    `<details class="fold"${open ? ' open' : ''}>
       <summary>${esc(title)}${count ? `<span class="count${count.warn ? ' warn' : ''}">${esc(count.text)}</span>` : ''}</summary>
       <div class="inner">${inner}</div>
     </details>`;

  return `
  <div class="meter">
    <div class="meter-top">
      <div class="meter-score">${s.total}</div>
      <div class="meter-grade">Grade ${esc(s.grade)}</div>
      <div class="meter-verdict">${esc(verdict(s.total))}</div>
    </div>
    <div class="segs">${segBars}</div>
    <div class="seg-labels">${segLabels}</div>
  </div>

  <div class="glance">${glance}</div>

  ${takeaway}

  <div class="folds">
    <h3>The full detail</h3>

    ${fold('Everything we found', { text: s.findings.length + ' items', warn: crit.length > 0 }, findingsHtml, false)}

    ${fold('How search engines see this page', null, `
      <div class="snippet"><div class="k">Title shown in search results</div>
        <div class="v ${seo.title?'':'empty'}">${seo.title ? esc(seo.title) : 'Missing'}</div></div>
      <div class="snippet"><div class="k">Description shown underneath</div>
        <div class="v ${seo.description?'':'empty'}">${seo.description ? esc(seo.description) : 'Missing — Google will write its own'}</div></div>
      <div class="snippet"><div class="k">Main heading on the page</div>
        <div class="v ${seo.h1s.length?'':'empty'}">${seo.h1s.length ? esc(seo.h1s[0]) : 'Missing'}</div></div>
      <div class="grid" style="margin-top:18px">
        ${row('Headings (H2 / H3)', `${seo.h2Count} / ${seo.h3Count}`)}
        ${row('Words of content', seo.wordCount)}
        ${row('Links on page', `${seo.internalLinks} internal, ${seo.externalLinks} out`)}
        ${row('Images missing alt text', `${seo.imagesMissingAlt} of ${seo.imageCount}`)}
        ${row('Structured data', seo.schemaBlocks ? `${seo.schemaBlocks} block(s)` : yn(false,'','None'))}
        ${row('Canonical tag', yn(!!seo.canonical))}
        ${row('Social preview image', yn(!!seo.ogImage))}
        ${row('Language set', seo.lang ? esc(seo.lang) : yn(false))}
        ${row('robots.txt', yn(fr.robotsTxt))}
        ${row('XML sitemap', yn(fr.sitemapFound))}
      </div>`, false)}

    ${fold('Visitor experience', null, `
      <div class="grid">
        ${row('Secure (HTTPS)', yn(ux.https))}
        ${row('Mobile-ready', yn(ux.mobileReady))}
        ${row('Server response', `${(ux.responseMs/1000).toFixed(2)}s`)}
        ${row('Page HTML size', `${ux.htmlKb} KB`)}
        ${row('Redirects before load', ux.redirectHops)}
        ${row('Scripts / stylesheets', `${ux.scripts} / ${ux.stylesheets}`)}
        ${row('Lazy-loaded images', `${ux.lazyImages} of ${ux.imageCount}`)}
        ${row('Modern image formats', ux.modernFormats ? yn(true) : yn(false,'','None'))}
        ${row('Compression', ux.compression ? esc(ux.compression) : yn(false,'','None'))}
        ${row('Tap-to-call link', yn(ux.hasTelLink))}
        ${row('Contact form', yn(ux.forms > 0))}
        ${row('Security headers', yn(ux.hsts && ux.xContentType, 'Present', 'Incomplete'))}
      </div>`, false)}

    ${fold('When the site was last touched',
      fr.daysSinceAnyUpdate != null ? { text: fr.daysSinceAnyUpdate + ' days ago', warn: fr.daysSinceAnyUpdate > 365 } : null, `
      <div class="grid">
        ${row('Most recent update', fr.newestLastmod ? fmtDate(fr.newestLastmod) : 'Not published')}
        ${row('Days since that update', fr.daysSinceAnyUpdate ?? '—')}
        ${row('Pages in sitemap', fr.pageCount || '—')}
        ${row('Pages with a date', fr.withLastmod || '—')}
        ${row('Untouched over a year', fr.staleOverYear || (fr.withLastmod ? '0' : '—'))}
        ${row('Updated in last 90 days', fr.updatedLast90 || (fr.withLastmod ? '0' : '—'))}
        ${row('Oldest page date', fr.oldestLastmod ? fmtDate(fr.oldestLastmod) : '—')}
        ${row('Footer copyright year', fr.copyrightYear || '—')}
      </div>
      ${fr.notes && fr.notes.length ? `<p class="src">${esc(fr.notes.join(' '))}</p>` : ''}`, false)}

    ${fold('Blog activity',
      bl.daysSinceLastPost != null
        ? { text: 'last post ' + bl.daysSinceLastPost + ' days ago', warn: bl.daysSinceLastPost > 180 }
        : { text: 'none found', warn: true }, `
      <div class="grid">
        ${row('Blog or feed found', yn(bl.feedFound || !!bl.blogUrlFound))}
        ${row('Posts detected', bl.postCount || '—')}
        ${row('Most recent post', bl.latestPostDate ? fmtDate(bl.latestPostDate) : '—')}
        ${row('Days since last post', bl.daysSinceLastPost ?? '—')}
        ${row('Posts in last 90 days', bl.postsLast90 ?? '—')}
        ${row('Posts in last 12 months', bl.postsLast365 ?? '—')}
        ${row('Typical gap between posts', bl.averageGapDays ? bl.averageGapDays + ' days' : '—')}
        ${row('Publishing pattern', esc(bl.cadence))}
      </div>
      ${posts}`, false)}

    ${domainHtml(d.domain)}
  </div>`;
}

function domainHtml(dm){
  if (!dm || !dm.queried) return '';
  const age = dm.ageYears !== null
    ? (dm.ageYears < 1 ? 'Under a year' : dm.ageYears + (dm.ageYears === 1 ? ' year' : ' years'))
    : '—';
  let exp = '—', expiringSoon = false;
  if (dm.daysToExpiry !== null){
    expiringSoon = dm.daysToExpiry < 45;
    exp = dm.daysToExpiry < 0
      ? `<span class="no">Expired ${Math.abs(dm.daysToExpiry)} days ago</span>`
      : expiringSoon
        ? `<span class="no">${fmtDate(dm.expires)} (${dm.daysToExpiry} days)</span>`
        : `${fmtDate(dm.expires)} (${dm.daysToExpiry} days)`;
  }
  const badge = dm.ageYears !== null
    ? `<span class="count${expiringSoon ? ' warn' : ''}">${esc(age)} old</span>` : '';
  return `<details class="fold"><summary>Domain registration${badge}</summary><div class="inner">
    <div class="grid">
      ${row('Domain', esc(dm.domain))}
      ${row('Registrar', dm.registrar ? esc(dm.registrar) : 'Not published')}
      ${row('Registered', dm.created ? fmtDate(dm.created) : '—')}
      ${row('Domain age', esc(age))}
      ${row('Expires', exp)}
      ${row('Privacy protection', dm.privacyProtected === null ? '—' : yn(dm.privacyProtected,'On','Off'))}
      ${row('DNSSEC', dm.dnssec === null ? '—' : yn(dm.dnssec,'Enabled','Off'))}
      ${row('Nameservers', dm.nameservers.length ? esc(dm.nameservers.length + ' found') : '—')}
    </div>
    <p class="src">Registration data from public RDAP records.</p>
  </div></details>`;
}


/* ── Marketing opportunities ──
   Each item names the gap in the customer's language and what service closes it. */
function marketingHtml(d, places){
  const social = d.social || { count:0, platforms:[], profiles:[], missingCore:['Facebook','Instagram'], hasAny:false };
  const ux = d.ux, bl = d.blog, fr = d.freshness, ar = d.archive || {};
  const items = [];

  /* reputation */
  if (places && places.found){
    const n = places.reviewCount || 0;
    const r = places.rating;
    if (n === 0){
      items.push(['high','No reviews on your Google listing',
        'Your business appears on Google Maps but has no reviews. Most people choose between businesses by comparing star ratings, so an empty listing loses to any competitor with even a handful.',
        'Reputation management']);
    } else if (n < 25){
      items.push(['high',
        `Only ${n} Google review${n===1?'':'s'}${r !== null && r < 4 ? ` at ${r.toFixed(1)} stars` : ''}`,
        `Competitors in most local categories carry well over a hundred. A thin review count reads as either new or inactive, and it is the first thing a customer compares.${r !== null && r < 4 ? ' With a rating under four stars on top of that, a lot of people filter you out before they reach your site.' : ''}`,
        'Reputation management']);
    } else if (r !== null && r < 4.0){
      items.push(['high',`Google rating is ${r.toFixed(1)} stars`,
        'Below four stars, a meaningful share of people filter you out before they ever reach your website. Responding to reviews and encouraging new ones moves this.',
        'Reputation management']);
    } else {
      items.push(['ok',`${n} Google reviews at ${r !== null ? r.toFixed(1) : '—'} stars`,
        'A solid base. Keeping it current and responding to every review protects it.',
        'Reputation management']);
    }
    if (places.websiteMatches === false){
      items.push(['high','Your Google listing points somewhere else',
        'The website on your Google Business Profile does not match this site, so traffic from Maps and search is going to the wrong place.',
        'Profile optimization']);
    }
  } else if (places && !places.found && !places.error){
    items.push(['high','No Google Business Profile found',
      'We could not find your business on Google Maps. For a local business this is the single biggest source of nearby customers, and without a listing you are invisible to people searching in your area.',
      'Profile optimization']);
  }

  /* social */
  if (!social.hasAny){
    items.push(['high','No social accounts linked from your site',
      'Nothing on the site points to Facebook, Instagram or anywhere else. Visitors who want to check you out before buying have nowhere to go, and you have no channel for repeat customers.',
      'Social posting + profile optimization']);
  } else if (social.missingCore.length){
    items.push(['warn',`Not on ${social.missingCore.join(' or ')}`,
      `You link to ${social.platforms.join(', ')}, but ${social.missingCore.join(' and ')} is where most local discovery happens now. Consistent posting on the right platforms is what keeps you in front of people between purchases.`,
      'Social posting + profile optimization']);
  } else {
    items.push(['ok',`Linked on ${social.platforms.join(', ')}`,
      'The accounts exist. What matters next is whether anything is posted to them regularly.',
      'Social posting']);
  }

  /* email capture */
  if (!ux.forms){
    items.push(['high','No way to capture visitor details',
      'There is no form on the page, so a visitor who is not ready to buy today leaves and you have no way to reach them again. Email is the cheapest channel you have, but it needs a list to work.',
      'Email marketing']);
  }

  /* speed */
  items.push(null); // placeholder replaced below if psi present

  /* content freshness */
  if (bl.daysSinceLastPost === null && !bl.feedFound){
    items.push(['warn','No blog or news section',
      'New content is how Google learns a site is still active, and how you stay relevant to customers between visits. Right now there is nothing being added.',
      'Website updates']);
  } else if (bl.daysSinceLastPost > 180){
    items.push(['warn',`Nothing published in ${bl.daysSinceLastPost} days`,
      'The blog exists but has stopped. A dormant blog is worse than none, because visitors see the last post date and assume the business slowed down.',
      'Website updates']);
  }

  if (fr.daysSinceAnyUpdate != null && fr.daysSinceAnyUpdate > 365){
    items.push(['warn',`The site has not changed in ${Math.floor(fr.daysSinceAnyUpdate/365)} year${fr.daysSinceAnyUpdate>730?'s':''}`,
      'Seasonal updates, current offers and fresh photos are what make a site feel like a business that is open. A static site reads as neglected.',
      'Website maintenance']);
  }

  /* photography */
  if (ux.imageCount <= 5){
    items.push(['warn',`Only ${ux.imageCount} image${ux.imageCount===1?'':'s'} on the page`,
      'Photography is what makes a small business look established. A handful of images, or stock ones, is the fastest thing a visitor notices and the easiest to fix.',
      'Professional photoshoot']);
  }

  const clean = items.filter(Boolean);
  if (!clean.length) return '';

  const rows = clean.map(([level,t,dsc,svc]) =>
    `<div class="mopp ${level === 'high' ? 'high' : level === 'ok' ? 'ok' : ''}">
      <span class="dotc"></span>
      <div class="txt"><div class="t">${esc(t)}</div><div class="d">${esc(dsc)}</div>
      <div class="svc">${esc(svc)}</div></div>
    </div>`).join('');

  /* reputation numbers strip */
  let repStrip = '';
  if (places && places.found){
    const n = places.reviewCount || 0, r = places.rating;
    const nb = n === 0 ? 'bad' : n < 25 ? 'mid' : 'good';
    const rb = r === null ? '' : r < 4 ? 'bad' : r < 4.5 ? 'mid' : 'good';
    repStrip = `<div class="rep">
      <div class="repbox ${nb}"><div class="n">${n}</div><div class="l">Google reviews</div></div>
      <div class="repbox ${rb}"><div class="n">${r !== null ? r.toFixed(1) : '—'}</div><div class="l">Star rating</div></div>
      <div class="repbox"><div class="n">${places.status === 'OPERATIONAL' ? 'Live' : '—'}</div><div class="l">Listing status</div></div>
    </div>
    ${places.mapsUrl ? `<div class="archive-links"><a href="${esc(places.mapsUrl)}" target="_blank" rel="noopener">View the Google listing</a></div>` : ''}`;
  }

  /* social chips */
  const known = ['Facebook','Instagram','X','LinkedIn','YouTube','TikTok','Yelp'];
  const chips = `<div class="chips">${known.map(k =>
    `<span class="chip${social.platforms.includes(k) ? '' : ' off'}">${esc(k)}</span>`).join('')}</div>`;

  /* archive exhibit */
  const archive = (ar.queried && ar.oldSnapshotUrl) ? `
    <div class="mopp">
      <span class="dotc"></span>
      <div class="txt">
        <div class="t">Compare the site to ${esc(ar.oldSnapshotYear)}</div>
        <div class="d">The Internet Archive has ${ar.snapshots} snapshots going back to ${fmtDate(ar.firstSeen)}. Open the ${esc(ar.oldSnapshotYear)} version side by side with the site today.</div>
        <div class="archive-links">
          <a href="${esc(ar.oldSnapshotUrl)}" target="_blank" rel="noopener">See it in ${esc(ar.oldSnapshotYear)}</a>
          ${ar.snapshotUrl ? `<a href="${esc(ar.snapshotUrl)}" target="_blank" rel="noopener">Most recent archive</a>` : ''}
        </div>
        <div class="svc">Website redesign</div>
      </div>
    </div>` : '';

  return `<div class="mktg">
    <header>
      <h3>Where marketing is leaking</h3>
      <p>Gaps outside the website itself, and what closes each one.</p>
    </header>
    <div class="items">
      ${repStrip}
      ${rows}
      ${archive}
      ${chips}
    </div>
  </div>`;
}

async function fetchPlaces(business){
  if (!business || (!business.name && !business.domain)) return null;
  try {
    const res = await fetch(PLACES_ENDPOINT, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(business)
    });
    return await res.json();
  } catch { return null; }
}


/* ── Which service fits ──
   Scores three services against the findings and writes a tailored pitch for the
   top one or two. Copy is original; service details are paraphrased from the
   public product pages. Nothing here is a quote or a commitment. */
function fitHtml(d, psi, places){
  const seo = d.seo, ux = d.ux, fr = d.freshness, bl = d.blog;
  const social = d.social || { hasAny:false, missingCore:[], platforms:[] };
  const ar = d.archive || {};
  const perf = psi && psi.scores ? psi.scores.performance : null;
  const platform = (d.platform && d.platform.detected) || [];

  /* Platforms where a rebuild is worth recommending on its own.
     Remove an entry here to stop auto-recommending a rebuild off it.
     `note` is the reason shown on the card. */
  const REBUILD_PLATFORMS = [
    { match:/wix/i,                       name:'Wix',
      note:'The site is built on Wix, so it cannot be moved elsewhere later without being rebuilt, and its SEO and speed are limited by the platform' },
    { match:/squarespace/i,               name:'Squarespace',
      note:'The site is built on Squarespace, which limits how far it can be extended or optimized compared with WordPress' },
    { match:/weebly/i,                    name:'Weebly',
      note:'The site is built on Weebly, a platform no longer actively developed, which leaves it increasingly dated' },
    { match:/duda/i,                      name:'Duda',
      note:'The site is built on Duda, so features and optimization are bounded by what the platform allows' },
    { match:/websites \+ marketing|godaddy website builder/i, name:'Websites + Marketing',
      note:'The site was built in Websites + Marketing by the owner, so the layout, the written content and the SEO structure are only as strong as the time they had to spend on it themselves' }
  ];

  const primary   = (d.platform && d.platform.primary) || null;
  const confident = !!(d.platform && d.platform.confident);
  const isWordPress = /wordpress/i.test(primary || '');
  // Only act on a platform-specific fingerprint, never a shared CDN guess.
  const builder = (confident && !isWordPress && primary)
    ? REBUILD_PLATFORMS.find(b => b.match.test(primary))
    : null;
  const onOtherBuilder = !!builder;

  const S = { design:{score:0, because:[]}, seo:{score:0, because:[]}, marketing:{score:0, because:[]} };
  const add = (k, pts, line) => { S[k].score += pts; if (line) S[k].because.push(line); };

  /* ── website redesign ── */
  // A confidently-detected non-WordPress builder is enough on its own to clear
  // the threshold, since a rebuild is the thing that changes it.
  if (builder) add('design', 6, builder.note);

  if (!ux.mobileReady) add('design', 5, 'The page has no mobile viewport setting, so it will not scale properly on phones');
  if (perf !== null && perf < 50) add('design', 4, `Google scores mobile performance at ${perf} out of 100`);
  else if (perf !== null && perf < 75) add('design', 2, `Mobile performance scores ${perf} out of 100`);
  if (!ux.forms && !ux.hasTelLink) add('design', 4, 'There is no form and no tappable phone number, so visitors have no easy way to make contact');
  else if (!ux.forms) add('design', 2, 'There is no contact form on the page');
  if (fr.daysSinceAnyUpdate != null && fr.daysSinceAnyUpdate > 730)
    add('design', 3, `Nothing on the site has changed in about ${Math.floor(fr.daysSinceAnyUpdate/365)} years`);
  if (ar.queried && ar.oldSnapshotYear)
    add('design', 2, `The Internet Archive shows the site looking much the same back in ${ar.oldSnapshotYear}`);
  if (seo.wordCount < 300) add('design', 2, `The homepage carries only about ${seo.wordCount} words of content`);
  if (ux.imageCount <= 5) add('design', 1, `Only ${ux.imageCount} image${ux.imageCount===1?'':'s'} on the page`);
  if (!ux.https) add('design', 4, 'The site is not served securely, so browsers warn visitors away');

  /* ── SEO services ── */
  if (!fr.sitemapFound) add('seo', 4, 'There is no XML sitemap, so search engines have to guess which pages exist');
  if (!seo.title || !seo.description) add('seo', 4, 'The page is missing its title or meta description, the two things Google shows in results');
  else if (seo.descriptionLength < 70 || seo.titleLength < 25) add('seo', 2, 'Title and description are too short to work hard in search results');
  if (seo.schemaBlocks === 0) add('seo', 3, 'No structured data, which is what produces rich results like ratings and business details');
  if (seo.h1Count !== 1) add('seo', 2, seo.h1Count === 0 ? 'The page has no main heading' : `The page has ${seo.h1Count} competing main headings`);
  if (bl.daysSinceLastPost === null && !bl.feedFound) add('seo', 4, 'There is no blog, so no new pages are being added for search engines to index');
  else if (bl.daysSinceLastPost > 180) add('seo', 3, `The blog stopped ${bl.daysSinceLastPost} days ago`);
  if (fr.pageCount && fr.staleOverYear / fr.pageCount > 0.7)
    add('seo', 2, `${fr.staleOverYear} of ${fr.pageCount} pages have not been touched in over a year`);
  if (seo.imagesMissingAlt > 0 && seo.imageCount > 0 && seo.imagesMissingAlt / seo.imageCount > 0.5)
    add('seo', 1, `${seo.imagesMissingAlt} of ${seo.imageCount} images have no alt text`);

  /* ── digital marketing ── */
  if (places && places.found === false) add('marketing', 5, 'No Google Business Profile could be found for this business');
  if (places && places.found){
    const n = places.reviewCount || 0, r = places.rating;
    if (n === 0) add('marketing', 5, 'The Google listing exists but has no reviews on it');
    else if (n < 25) add('marketing', 4, `Only ${n} Google review${n===1?'':'s'} so far`);
    if (r !== null && r < 4) add('marketing', 3, `The Google rating sits at ${r.toFixed(1)} stars`);
    if (places.websiteMatches === false) add('marketing', 3, 'The website listed on the Google profile points somewhere other than this site');
  }
  if (!social.hasAny) add('marketing', 5, 'The site links to no social accounts at all');
  else if (social.missingCore.length) add('marketing', 2, `No link to ${social.missingCore.join(' or ')}`);
  if (!ux.forms) add('marketing', 3, 'There is no signup or contact form, so there is no way to build an email list');
  if (ux.imageCount <= 5) add('marketing', 1, 'Very few photographs on the page');
  if (perf !== null && perf < 50) add('marketing', 1, 'Slow mobile performance, which also wastes paid traffic');

  const COPY = {
    design: {
      title: 'Website Design Services',
      lead: 'This site is working against the business rather than for it. A rebuild addresses the structural problems, not just the surface.',
      incl: 'Designers and copywriters build the site on WordPress, typically over about six to eight weeks. Plans cover a consultation, written content, on-page SEO structure, and a responsive layout for phones and tablets. Existing content can be migrated, and old URLs are redirected so current search rankings are carried across. Higher tiers add booking, client forms and an online store.',
      url: 'https://www.godaddy.com/websites/web-design',
      migrate: 'A redesign would also move the site onto WordPress, which is easier to extend, optimize and hand to any developer later. Existing text, images and posts can be carried over, and old page addresses are redirected so current search rankings follow across.'
    },
    seo: {
      title: 'SEO Services',
      lead: 'The site is technically invisible in places where it should be easy to find. These are fixable, and most of the work is ongoing rather than one-off.',
      incl: 'An SEO team reviews the site, researches keywords for the business and its area, then works on both on-page items (titles, descriptions, image alt text) and off-page ones (directory listings, links, published content). Progress is tracked in a dashboard with regular check-ins. On-page changes are sent for approval before they go live.',
      url: 'https://www.godaddy.com/online-marketing/seo-services',
      caveat: 'Search results depend on competition and the market, so no ranking outcome can be guaranteed. GoDaddy publishes its own figures on typical results.'
    },
    marketing: {
      title: 'Digital Marketing Services',
      lead: 'The website is only part of the problem here. The bigger gaps are outside it, in reputation and in the channels that bring people back.',
      incl: 'A managed service covering social posting and paid campaigns on Meta, Instagram and Google, reputation management responding to reviews on Google, Facebook and Yelp, social profile cleanup, and email marketing. The Premium plan also includes a professional photoshoot, a brand guide, quarterly SEO scans and ongoing site maintenance.',
      url: 'https://www.godaddy.com/online-marketing/digital-marketing-services'
    }
  };

  const ranked = Object.entries(S)
    .map(([k,v]) => ({ key:k, ...v }))
    .filter(x => x.score >= 5)
    .sort((a,b) => b.score - a.score)
    .slice(0, 2);

  // Even when nothing scores high enough, WDS still gets its mention.
  if (!ranked.length) return `<div class="fit">
    <header>
      <h3>Where we would start</h3>
      <p>Nothing urgent turned up in this scan.</p>
    </header>
    <div class="wdsline"><b>This site is in good shape.</b> If the business ever wants a
    refresh without doing the work themselves, Website Design Services has GoDaddy's
    designers and copywriters build it on WordPress, with consultation, written content
    and on-page SEO included, and existing content carried across.
    <a href="https://www.godaddy.com/websites/web-design" target="_blank" rel="noopener">See how it works</a></div>
    <div class="fitnote">This report comes from an automated scan and is a starting point for a conversation, not a quote, a commitment or a guarantee of results. GoDaddy services are provided by GoDaddy under their own terms; this report is independent and is not a GoDaddy product or offer.</div>
  </div>`;

  // WDS gets a mention on every report, even when the scan points elsewhere.
  const designAlreadyShown = ranked.some(x => x.key === 'design');
  const wdsAlways = designAlreadyShown ? '' : `<div class="wdsline">
    <b>Worth knowing about either way:</b> with Website Design Services, GoDaddy's
    designers and copywriters build the site for you on WordPress rather than you
    building it yourself. Consultation, written content and on-page SEO are part of
    the build, and an existing site can be redesigned with its content carried over.
    <a href="https://www.godaddy.com/websites/web-design" target="_blank" rel="noopener">See how it works</a>
  </div>`;

  const cards = ranked.map((x, i) => {
    const c = COPY[x.key];
    const reasons = x.because.slice(0, 4);
    return `<div class="fitcard">
      <span class="rank">${i === 0 ? 'Strongest fit' : 'Also worth discussing'}</span>
      <h4>${esc(c.title)}</h4>
      <div class="why">${esc(c.lead)}</div>
      <ul class="because">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="incl"><b>What the service covers</b>${esc(c.incl)}${
        x.key === 'design' && onOtherBuilder ? ' ' + esc(c.migrate) : ''}</div>
      ${x.key === 'design' && builder ? `<p class="src">Detected platform: ${esc(builder.name)}.</p>` : ''}
      ${c.caveat ? `<p class="src">${esc(c.caveat)}</p>` : ''}
      <div class="cta">
        <a href="${esc(c.url)}" target="_blank" rel="noopener">See what's included</a>
        <span>Ask your guide for current pricing.</span>
      </div>
    </div>`;
  }).join('');

  return `<div class="fit">
    <header>
      <h3>Where we would start</h3>
      <p>Based on what this scan found, matched to services that address it.</p>
    </header>
    ${cards}
    ${wdsAlways}
    <div class="fitnote">These suggestions come from an automated scan and are a starting point for a conversation, not a quote, a commitment or a guarantee of results. GoDaddy services are provided by GoDaddy under their own terms; this report is independent and is not a GoDaddy product or offer.</div>
  </div>`;
}

/* ── PageSpeed ── */
function psiHtml(p){
  if (!p) return '';
  if (p.error) return `<div class="sect"><h3>Speed and experience, measured by Google</h3>
    <p class="pending" style="color:var(--crit)">${esc(p.error)}</p></div>`;

  const cards = [
    ['Performance', p.scores.performance], ['Accessibility', p.scores.accessibility],
    ['Best practices', p.scores.bestPractices], ['SEO', p.scores.seo]
  ].map(([l,n]) => `<div class="psi-score ${band(n)}"><div class="n">${n===null?'—':n}</div><div class="l">${l}</div></div>`).join('');

  const f = p.field;
  const fieldInner = f ? `
    <div class="grid">
      ${row('Overall verdict', esc(f.overall || '—'))}
      ${row('Largest paint (LCP)', f.lcp ? `${f.lcp.value}${f.lcp.unit} <span style="color:var(--muted);font-weight:400">${esc(f.lcp.rating)}</span>` : '—')}
      ${row('Responsiveness (INP)', f.inp ? `${f.inp.value}${f.inp.unit} <span style="color:var(--muted);font-weight:400">${esc(f.inp.rating)}</span>` : '—')}
      ${row('Layout shift (CLS)', f.cls ? `${f.cls.value} <span style="color:var(--muted);font-weight:400">${esc(f.cls.rating)}</span>` : '—')}
    </div>
    <p class="src">From the Chrome User Experience Report, based on real Chrome users over the last 28 days. This is the data that feeds Google's page experience signals.</p>` : '';

  const opps = p.opportunities || [];
  const oppInner = opps.length
    ? `<ul class="opp">${opps.map(o => {
        const save = o.savingsMs ? `${(o.savingsMs/1000).toFixed(1)}s` : `${o.savingsKb} KB`;
        return `<li><span>${esc(o.title)}</span><span class="save">saves ${esc(save)}</span></li>`;
      }).join('')}</ul>` : '';

  // The speed wins are the persuasive part, so they open by default.
  return `<div class="folds" style="margin-top:38px">
    <h3>Speed and experience, measured by Google</h3>
    <div class="psi-scores" style="margin-bottom:6px">${cards}</div>
    <p class="src" style="margin-bottom:14px">Scored by Google Lighthouse on a simulated mobile device. 90 and above is good, below 50 is poor.</p>

    ${opps.length ? `<details class="fold" open><summary>Biggest speed wins<span class="count">${opps.length}</span></summary>
      <div class="inner">${oppInner}</div></details>` : ''}

    ${f ? `<details class="fold"><summary>What real visitors experienced<span class="count">${esc(f.overall || 'field data')}</span></summary>
      <div class="inner">${fieldInner}</div></details>` : ''}

    <details class="fold"><summary>Lab timings</summary><div class="inner">
      <div class="grid">
        ${row('Largest paint', esc(p.lab.lcp || '—'))}
        ${row('Layout shift', esc(p.lab.cls || '—'))}
        ${row('Blocking time', esc(p.lab.tbt || '—'))}
        ${row('First paint', esc(p.lab.fcp || '—'))}
        ${row('Speed index', esc(p.lab.speedIndex || '—'))}
      </div>
    </div></details>
  </div>`;
}

/* Runs Lighthouse from the browser. Netlify functions cap at 10s on most plans
   and Lighthouse often needs 30, so this cannot go through the server. */
async function fetchPsi(url){
  if (!PSI_KEY) return { error: 'Performance checks are not set up. Add your PageSpeed API key in app.js.' };

  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', url);
  api.searchParams.set('strategy', 'mobile');
  ['performance','accessibility','best-practices','seo'].forEach(c => api.searchParams.append('category', c));
  api.searchParams.set('key', PSI_KEY);

  try {
    const res = await fetch(api.href, { signal: AbortSignal.timeout(90000) });
    const j = await res.json();
    if (j.error){
      const m = j.error.message || '';
      if (/API key not valid/i.test(m)) return { error: 'The PageSpeed API key is not valid. Check it is enabled in Google Cloud Console.' };
      if (/referer|referrer|blocked/i.test(m)) return { error: 'Google rejected the key for this site. Add this domain under Application restrictions.' };
      if (/quota|rate/i.test(m)) return { error: 'PageSpeed quota reached. Wait a moment and try again.' };
      if (/lighthouse|DOCUMENT_REQUEST|ERRORED/i.test(m)) return { error: 'Google could not load that page. The site may be blocking automated requests.' };
      return { error: m || 'The performance check failed.' };
    }

    const lr = j.lighthouseResult || {};
    const c  = lr.categories || {};
    const dv = k => (lr.audits && lr.audits[k] && lr.audits[k].displayValue) || null;

    return {
      scores: {
        performance: pct(c.performance && c.performance.score),
        accessibility: pct(c.accessibility && c.accessibility.score),
        bestPractices: pct(c['best-practices'] && c['best-practices'].score),
        seo: pct(c.seo && c.seo.score)
      },
      lab: { lcp:dv('largest-contentful-paint'), cls:dv('cumulative-layout-shift'),
             tbt:dv('total-blocking-time'), fcp:dv('first-contentful-paint'),
             speedIndex:dv('speed-index') },
      field: readField(j.loadingExperience) || readField(j.originLoadingExperience),
      opportunities: readOpportunities(lr.audits)
    };
  } catch (err) {
    return { error: err.name === 'TimeoutError'
      ? 'Google took too long to analyze that page.'
      : 'Could not reach the PageSpeed service: ' + (err.message || 'unknown error') };
  }
}

function readField(exp){
  if (!exp || !exp.metrics) return null;
  const m = exp.metrics;
  const pick = (key, divide, unit) => {
    const d = m[key];
    if (!d) return null;
    return { value:+(d.percentile/divide).toFixed(divide===1?0:2), unit,
             rating: d.category ? d.category.toLowerCase().replace(/_/g,' ') : '' };
  };
  return {
    overall: exp.overall_category ? exp.overall_category.toLowerCase().replace(/_/g,' ') : null,
    lcp: pick('LARGEST_CONTENTFUL_PAINT_MS',1000,'s'),
    inp: pick('INTERACTION_TO_NEXT_PAINT',1,'ms'),
    cls: pick('CUMULATIVE_LAYOUT_SHIFT_SCORE',100,'')
  };
}

function readOpportunities(audits){
  if (!audits) return [];
  const out = [];
  for (const id in audits){
    const a = audits[id];
    if (!a || a.score === null || a.score === undefined || a.score >= 0.9) continue;
    const ms = a.details && a.details.overallSavingsMs;
    const by = a.details && a.details.overallSavingsBytes;
    if (!ms && !by) continue;
    out.push({ title:a.title, savingsMs: ms?Math.round(ms):null, savingsKb: by?Math.round(by/1024):null });
  }
  return out.sort((a,b)=>(b.savingsMs||0)-(a.savingsMs||0)||(b.savingsKb||0)-(a.savingsKb||0)).slice(0,6);
}

/* ── the legal block, identical everywhere ── */
function disclaimerHtml(){
  return `<details class="disclaimer" id="legal"><summary style="cursor:pointer;font-weight:700;font-size:.95rem">Important: please read before relying on this report</summary><div style="margin-top:10px">
    <p><strong>This is not a GoDaddy tool.</strong> This Website Health Check is an independent personal project. It was created and is operated solely by its author, who is employed by GoDaddy Inc. but who built and runs this tool on personal time, using personal resources, and outside the scope of their employment. GoDaddy Inc. and its affiliates did not create, commission, review, approve, endorse, sponsor, license or authorize this tool or this report. No statement, score, finding or recommendation here is made by, on behalf of, or attributable to GoDaddy, and nothing here should be read as a GoDaddy assessment, quote, offer, commitment or official communication. The author is not acting as a representative or agent of GoDaddy in providing this report. Any reference to GoDaddy is for identification only, and all GoDaddy trademarks and brand names remain the property of their owner.</p>
    <p><strong>The results are automated estimates, not a professional audit.</strong> This tool reads publicly available information from the address entered at a single moment in time and applies its own scoring. It is informational only. It is not a professional SEO audit, security assessment, accessibility conformance evaluation or compliance review, and it is not legal, financial, technical, regulatory or business advice. The scores and grades are the author's own weighting. They are not produced by, affiliated with or validated by Google or any other search engine, and they do not measure or forecast how any search engine will rank, index or treat a website. No guarantee is made regarding rankings, traffic, conversions or revenue.</p>
    <p><strong>Results may be incomplete or wrong.</strong> Websites that block automated requests, build content with JavaScript, sit behind a login or firewall, or change after the scan may produce misleading results. Absence of a finding does not mean absence of a problem. This report is provided "as is" and "as available", without warranty of any kind, express or implied, including any implied warranty of accuracy, completeness, merchantability, fitness for a particular purpose or non-infringement. You are solely responsible for independently verifying any finding before acting on it. To the fullest extent permitted by law, the author disclaims all liability for any loss or damage arising from use of, or reliance on, this tool or this report.</p>
    <p><strong>Permitted use.</strong> Run this tool only on websites you own or have explicit permission to test.</p>
  </div></details>`;
}
