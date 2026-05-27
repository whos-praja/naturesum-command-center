// Mock data for Naturesum Command Center
const NSData = (function () {
  const fmtINR = (n) => {
    if (n == null) return "—";
    if (Math.abs(n) >= 10000000) return "₹" + (n/10000000).toFixed(2) + " Cr";
    if (Math.abs(n) >= 100000) return "₹" + (n/100000).toFixed(2) + " L";
    if (Math.abs(n) >= 1000) return "₹" + (n/1000).toFixed(1) + "K";
    return "₹" + n;
  };
  const fmtN = (n) => n.toLocaleString("en-IN");
  const pct = (n, d=1) => (n>=0?"+":"") + n.toFixed(d) + "%";

  // ── SKUs ──────────────────────────────────────────────
  const skus = [
    { code: "NS-WHT-CHO-1K", name: "Whey Protein — Chocolate", variant: "1 kg",   active: true,  velocity: 142 },
    { code: "NS-WHT-VAN-1K", name: "Whey Protein — Vanilla",   variant: "1 kg",   active: true,  velocity:  98 },
    { code: "NS-WHT-CHO-2K", name: "Whey Protein — Chocolate", variant: "2 kg",   active: true,  velocity:  64 },
    { code: "NS-MUL-MEN-60", name: "Daily Multivitamin (Men)", variant: "60 ct",  active: true,  velocity: 211 },
    { code: "NS-MUL-WMN-60", name: "Daily Multivitamin (Women)", variant: "60 ct", active: true, velocity: 184 },
    { code: "NS-OMG-3-90",   name: "Omega-3 Fish Oil",         variant: "90 ct",  active: true,  velocity: 156 },
    { code: "NS-BIO-HAIR-60",name: "Biotin + Hair Complex",    variant: "60 ct",  active: true,  velocity: 132 },
    { code: "NS-COL-PEP-250",name: "Collagen Peptides",        variant: "250 g",  active: true,  velocity:  77 },
    { code: "NS-ASH-500-60", name: "Ashwagandha 500mg",        variant: "60 ct",  active: true,  velocity:  88 },
    { code: "NS-PRO-VEG-1K", name: "Plant Protein — Choco",    variant: "1 kg",   active: true,  velocity:  41 },
    { code: "NS-CRT-MON-250",name: "Creatine Monohydrate",     variant: "250 g",  active: true,  velocity:  62 },
    { code: "NS-VITD-2K-60", name: "Vitamin D3 2000 IU",       variant: "60 ct",  active: true,  velocity: 109 },
    { code: "NS-PRE-GUT-30", name: "Pre-Probiotic Gut Health", variant: "30 ct",  active: true,  velocity:  54 },
    { code: "NS-MAGNESIUM",  name: "Magnesium Glycinate",      variant: "60 ct",  active: false, velocity:   0 },
  ];

  // ── Channels ──────────────────────────────────────────
  const channels = [
    { id: "amazon",   name: "Amazon",    short: "AMZ",  color: "#E47911", payout: "D+7" },
    { id: "shopify",  name: "Shopify",   short: "SHP",  color: "#5E8E3E", payout: "D+1" },
    { id: "flipkart", name: "Flipkart",  short: "FK",   color: "#2874F0", payout: "D+10" },
    { id: "blinkit",  name: "Blinkit",   short: "BLK",  color: "#F8CB46", payout: "D+15" },
    { id: "instamart",name: "Instamart", short: "INS",  color: "#FC8019", payout: "—" },
  ];

  // revenue today by channel
  const revenueToday = {
    amazon:   485000,
    shopify:  312000,
    flipkart: 168000,
    blinkit:   94000,
    instamart:     0,
  };
  const revenueYesterday = {
    amazon:   442000,
    shopify:  298000,
    flipkart: 182000,
    blinkit:   71000,
    instamart:     0,
  };
  // 7-day rolling average revenue by channel (last 7 days excluding today)
  const revenue7dAvg = {
    amazon:   438000,
    shopify:  286000,
    flipkart: 174000,
    blinkit:   78000,
    instamart:     0,
  };

  // Aggregate cash flow expected
  const cashExpected = {
    inflow7d:  2860000,   // ₹28.6L
    inflow30d: 9500000,   // ₹95L
    outflow7d: 480000,    // ₹4.8L
    outflow30d:3900000,   // ₹39L
  };
  const revenueMTD = 28940000; // 2.89 Cr
  const revenueMTDLast = 24210000;
  const revenueMTDTarget = 35000000;

  // 30-day revenue trend (in lakhs)
  const trend30 = [7.8, 8.2, 7.6, 9.1, 9.4, 8.8, 9.6, 10.1, 9.8, 9.4, 10.2, 11.1, 10.4, 9.9, 11.4, 11.7, 12.0, 11.3, 10.8, 11.6, 12.2, 12.4, 11.8, 12.6, 13.1, 12.7, 13.4, 13.0, 12.9, 13.5];

  // ── Alerts ────────────────────────────────────────────
  const alerts = [
    { id: "a1", sev: "crit", cat: "Inventory",  title: "Stockout imminent — Daily Multivitamin (Women)", detail: "8 days runway on Amazon FBA · lead time 21 days · reorder window passed",  module: "inventory", time: "12 min ago", roles: ["founder","ops","marketplace"] },
    { id: "a2", sev: "crit", cat: "Marketplace", title: "Amazon listing suppressed — Whey Choc 2kg", detail: "ASIN B09… flagged for image policy. Listing inactive since 06:48 IST.", module: "marketplace", time: "1h 12m ago", roles: ["founder","marketplace"] },
    { id: "a3", sev: "crit", cat: "Finance",    title: "Cash projection breaches ₹40L floor on Jun 04", detail: "Supplier payments due ₹18.4L · expected payouts ₹14.2L", module: "finance", time: "3h ago", roles: ["founder","vcfo"] },
    { id: "a4", sev: "warn", cat: "Marketing",  title: "Meta Ads overpacing — 18% above daily budget", detail: "₹62K spent vs ₹52K target · auction CPM up 22% WoW", module: "marketing", time: "2h ago", roles: ["founder","ads"] },
    { id: "a5", sev: "warn", cat: "Marketplace", title: "Rating drop — Collagen Peptides at 3.9★", detail: "4 new 1–2★ reviews in last 48h · last cohort cited 'taste'", module: "marketplace", time: "5h ago", roles: ["founder","marketplace"] },
    { id: "a6", sev: "warn", cat: "Inventory",  title: "Batch B-2412-OMG3 expiring in 47 days", detail: "1,840 units remaining · velocity won't clear · move to flash sale?", module: "inventory", time: "8h ago", roles: ["founder","ops"] },
    { id: "a7", sev: "warn", cat: "Sales",      title: "Returns spike — Plant Protein up 3.2× vs 30-day avg", detail: "12 returns in last 7d · 'lumpy when mixed' cited 8×", module: "sales", time: "yesterday", roles: ["founder","ops","marketplace"] },
    { id: "a8", sev: "info", cat: "Marketing",  title: "ROAS up 45% on Biotin+Hair — consider scaling budget", detail: "Meta creative #BIO-V3 driving CAC ₹312 vs blended ₹486", module: "marketing", time: "yesterday", roles: ["founder","ads"] },
    { id: "a9", sev: "info", cat: "Inventory",  title: "Whey Choc 1kg — 8 days FBA, 45 days warehouse", detail: "Recommend FBA replenishment shipment of 600 units", module: "inventory", time: "yesterday", roles: ["founder","ops","marketplace"] },
    { id: "a10",sev: "info", cat: "Sales",      title: "Blinkit revenue +60% WoW", detail: "Ashwagandha + Multivitamin driving lift · check ad support", module: "sales", time: "2d ago", roles: ["founder"] },
  ];

  // ── SKU sales table (Sales module) ───────────────────
  const skuSales = skus.filter(s => s.active).map((s, i) => {
    const total = s.velocity * 30 * (380 + (i%4)*55);
    const splits = {
      amazon:   Math.round(total * (0.35 + (i%5)*0.03)),
      shopify:  Math.round(total * (0.28 - (i%4)*0.02)),
      flipkart: Math.round(total * (0.18 + (i%3)*0.01)),
      blinkit:  Math.round(total * (0.12 + (i%6)*0.005)),
    };
    return {
      ...s,
      revenue30: Math.round(Object.values(splits).reduce((a,b)=>a+b,0)),
      units30: s.velocity * 30,
      aov: 380 + (i%4)*55,
      returnRate: 1.4 + (i%5)*0.35,
      growth: ([12.4, -4.1, 18.2, 8.6, 22.4, -2.2, 32.1, -8.4, 14.6, -22.4, 6.8, 19.2, 4.4])[i] || 5,
      splits,
    };
  });

  // ── Inventory ─────────────────────────────────────────
  // Mock warehouse breakdown per SKU:
  //   fg          = finished goods, ready to ship (this is the current "warehouse" number)
  //   semiFg      = bulk product made, not yet packed/labelled
  //   rawMaterial = ingredient stock (units roughly equivalent to potential FG units)
  //   packaging   = bottles/jars/labels/cartons ready to fill
  //   perPacketRaw= raw units required to produce one FG pack (for future formula)
  // "Producible FG" today = min(semiFg, packaging) — what we could pack & ship right now.
  const inventory = skuSales.map((s, i) => {
    const leadTime = [21, 21, 28, 18, 18, 25, 30, 35, 21, 28, 18, 25, 30][i] || 21;
    const totalStock = {
      warehouse: [420, 380, 240, 1450, 1860, 980, 620, 310, 580, 920, 410, 1240, 380][i] || 500,
      amazonFBA: [610, 510, 220, 1480, 220, 920, 540, 380, 410, 380, 280, 880, 290][i] || 300,
      flipkart:  [180, 140, 90,  420,  340,  310, 230, 140, 180, 220, 110, 380, 140][i] || 120,
      blinkit:   [120, 90,  60,  280,  240,  210, 160, 80,  120, 140, 80,  240, 90][i]  || 80,
      transit:   [0,   200, 0,   0,    0,    400, 0,   200, 0,   0,   0,   500, 0][i]   || 0,
    };
    const fg = totalStock.warehouse;
    const warehouseBreakdown = {
      fg,
      semiFg:      [380, 290, 190, 1200, 1620, 820, 510, 240, 460, 720, 360, 1020, 320][i] || Math.round(fg * 0.85),
      rawMaterial: [620, 540, 380, 2100, 2400, 1380, 880, 520, 760, 1140, 520, 1620, 480][i] || Math.round(fg * 1.4),
      packaging:   [510, 410, 260, 1380, 1580, 940, 600, 280, 540, 800, 420, 1180, 360][i] || Math.round(fg * 1.1),
      perPacketRaw:[1.05, 1.05, 2.10, 0.85, 0.85, 0.90, 0.95, 1.00, 1.10, 1.00, 0.95, 0.80, 1.05][i] || 1.0,
    };
    warehouseBreakdown.producibleFG = Math.min(warehouseBreakdown.semiFg, warehouseBreakdown.packaging);
    const total = totalStock.warehouse + totalStock.amazonFBA + totalStock.flipkart + totalStock.blinkit;
    const runway = Math.round(total / s.velocity);
    const runwayStatus = runway <= leadTime ? "red" : runway < 30 ? "amber" : "green";
    return {
      ...s,
      leadTime,
      stock: totalStock,
      warehouseBreakdown,
      totalStock: total,
      runway,
      runwayStatus,
      stockValue: total * (i % 3 === 0 ? 480 : i % 3 === 1 ? 280 : 180),
    };
  });

  // ── Batches ───────────────────────────────────────────
  const batches = [
    { id: "B-2503-WHT01", sku: "NS-WHT-CHO-1K", mfg: "Mar 2025", exp: "Mar 2027", units: 980,  loc: "Warehouse", risk: "green" },
    { id: "B-2502-MUL-W", sku: "NS-MUL-WMN-60", mfg: "Feb 2025", exp: "Aug 2026", units: 1240, loc: "Amazon FBA", risk: "amber" },
    { id: "B-2412-OMG3",  sku: "NS-OMG-3-90",   mfg: "Dec 2024", exp: "Jul 2026", units: 1840, loc: "Warehouse", risk: "red" },
    { id: "B-2501-BIO",   sku: "NS-BIO-HAIR-60",mfg: "Jan 2025", exp: "Jan 2027", units: 720,  loc: "Warehouse", risk: "green" },
    { id: "B-2410-COL",   sku: "NS-COL-PEP-250",mfg: "Oct 2024", exp: "Oct 2026", units: 310,  loc: "Mixed",     risk: "amber" },
    { id: "B-2504-ASH",   sku: "NS-ASH-500-60", mfg: "Apr 2025", exp: "Apr 2027", units: 580,  loc: "Warehouse", risk: "green" },
    { id: "B-2411-VEG-P", sku: "NS-PRO-VEG-1K", mfg: "Nov 2024", exp: "May 2026", units: 920,  loc: "Warehouse", risk: "red" },
    { id: "B-2502-CRT",   sku: "NS-CRT-MON-250",mfg: "Feb 2025", exp: "Feb 2027", units: 410,  loc: "Warehouse", risk: "green" },
    { id: "B-2503-VITD",  sku: "NS-VITD-2K-60", mfg: "Mar 2025", exp: "Mar 2027", units: 1240, loc: "Amazon FBA", risk: "green" },
  ];

  // ── Suppliers ─────────────────────────────────────────
  const suppliers = [
    { id: "SUP-001", name: "Glanbia Performance Nutrition", contact: "Rohit Mehra", phone: "+91 98xxx 12340", supplies: "Whey protein concentrate, isolate", moq: "500 kg", lead: 21, payment: "30% advance, 70% on delivery", skus: ["NS-WHT-CHO-1K","NS-WHT-VAN-1K","NS-WHT-CHO-2K"], reliability: 94 },
    { id: "SUP-002", name: "Lonza India",             contact: "Priya Iyer",   phone: "+91 99xxx 88210", supplies: "Vitamins, minerals premix",   moq: "200 kg",  lead: 18, payment: "Net 30",                  skus: ["NS-MUL-MEN-60","NS-MUL-WMN-60","NS-VITD-2K-60"], reliability: 88 },
    { id: "SUP-003", name: "Marpol Pvt Ltd",          contact: "Amit Shah",    phone: "+91 91xxx 44012", supplies: "Fish oil, omega-3 concentrate", moq: "100 kg", lead: 25, payment: "50% advance, balance on dispatch", skus: ["NS-OMG-3-90"], reliability: 91 },
    { id: "SUP-004", name: "DSM Nutritional Products", contact: "Suresh K.",   phone: "+91 98xxx 91020", supplies: "Biotin, B-complex actives",   moq: "50 kg",   lead: 30, payment: "Net 45",                  skus: ["NS-BIO-HAIR-60"], reliability: 76 },
    { id: "SUP-005", name: "Rousselot India",         contact: "Kavya Reddy",  phone: "+91 90xxx 33121", supplies: "Bovine collagen peptides",    moq: "300 kg",  lead: 35, payment: "Net 30",                  skus: ["NS-COL-PEP-250"], reliability: 82 },
    { id: "SUP-006", name: "Arjuna Natural",          contact: "Bijoy Cherian",phone: "+91 94xxx 21034", supplies: "Ashwagandha root extract (KSM-66)", moq: "100 kg", lead: 21, payment: "Net 30", skus: ["NS-ASH-500-60"], reliability: 96 },
    { id: "SUP-007", name: "Ingredia",                contact: "Manish Kumar", phone: "+91 95xxx 60189", supplies: "Plant protein blend",          moq: "500 kg", lead: 28, payment: "30% advance, 70% on delivery", skus: ["NS-PRO-VEG-1K"], reliability: 79 },
    { id: "SUP-008", name: "Packwell Industries",     contact: "Deepak Singh", phone: "+91 99xxx 11023", supplies: "Containers, lids, seals (packaging)", moq: "10K units", lead: 14, payment: "Net 30", skus: ["(all)"], reliability: 93 },
    { id: "SUP-009", name: "Print Origin",            contact: "Rhea Pillai",  phone: "+91 88xxx 22090", supplies: "Labels, cartons (packaging)", moq: "5K units", lead: 10, payment: "Net 15", skus: ["(all)"], reliability: 89 },
  ];

  // ── PO Log ────────────────────────────────────────────
  const poLog = [
    { id: "PO-2026-0118", supplier: "Glanbia Performance Nutrition", date: "May 02, 2026", items: "Whey protein isolate · 1,200 kg", expected: "May 23, 2026", actual: "May 21, 2026", status: "Delivered", deltaDays: -2 },
    { id: "PO-2026-0117", supplier: "Lonza India", date: "May 06, 2026", items: "Multivitamin premix · 400 kg", expected: "May 24, 2026", actual: null, status: "In transit", deltaDays: 0 },
    { id: "PO-2026-0116", supplier: "Marpol Pvt Ltd", date: "Apr 28, 2026", items: "Omega-3 concentrate · 200 kg", expected: "May 23, 2026", actual: "May 26, 2026", status: "Delivered", deltaDays: +3 },
    { id: "PO-2026-0115", supplier: "Arjuna Natural", date: "May 04, 2026", items: "KSM-66 Ashwagandha · 150 kg", expected: "May 25, 2026", actual: null, status: "In transit", deltaDays: 0 },
    { id: "PO-2026-0114", supplier: "DSM Nutritional Products", date: "Apr 14, 2026", items: "Biotin actives · 60 kg", expected: "May 14, 2026", actual: "May 19, 2026", status: "Delivered", deltaDays: +5 },
    { id: "PO-2026-0113", supplier: "Packwell Industries", date: "May 01, 2026", items: "1kg whey tubs · 15K units", expected: "May 15, 2026", actual: "May 15, 2026", status: "Delivered", deltaDays: 0 },
  ];

  // ── Marketing ─────────────────────────────────────────
  const adAccounts = {
    google: { spendMTD: 1840000, revAttrib: 6240000, roas: 3.39, cac: 412, impressions: 4820000, clicks: 64200, conversions: 4480, budget: 2500000 },
    meta:   { spendMTD: 2120000, revAttrib: 7910000, roas: 3.73, cac: 386, impressions: 8210000, clicks: 88400, conversions: 5490, budget: 2400000 },
  };

  const googleCampaigns = [
    { name: "Search · Brand · Naturesum",     spend: 184000, roas: 8.42, cac: 124, conv: 1480, status: "Active" },
    { name: "Search · Whey Protein",          spend: 412000, roas: 4.18, cac: 384, conv: 1072, status: "Active" },
    { name: "Search · Multivitamins",         spend: 318000, roas: 3.62, cac: 412, conv:  772, status: "Active" },
    { name: "PMax · All products",            spend: 540000, roas: 2.94, cac: 482, conv: 1120, status: "Active" },
    { name: "Display · Remarketing",          spend: 184000, roas: 2.18, cac: 612, conv:  300, status: "Active" },
    { name: "YouTube · Hair & Skin",          spend: 202000, roas: 1.61, cac: 894, conv:  226, status: "Paused" },
  ];

  const metaCampaigns = [
    { name: "ABO · Whey Protein · Lookalike 1%",    spend: 412000, roas: 4.92, cac: 312, conv: 1320, status: "Active" },
    { name: "ABO · Multivitamin · Interest stack",  spend: 360000, roas: 3.86, cac: 384, conv:  938, status: "Active" },
    { name: "CBO · Hair & Biotin · UGC creatives",  spend: 290000, roas: 5.21, cac: 268, conv: 1082, status: "Active" },
    { name: "CBO · Ashwagandha · Static",           spend: 184000, roas: 3.14, cac: 412, conv:  447, status: "Active" },
    { name: "Retargeting · ATC 14d",                spend: 218000, roas: 6.04, cac: 184, conv: 1184, status: "Active" },
    { name: "Prospecting · Plant Protein launch",   spend: 240000, roas: 1.86, cac: 712, conv:  337, status: "Active" },
    { name: "Catalog · Collagen Peptides",          spend: 168000, roas: 2.42, cac: 488, conv:  344, status: "Paused" },
  ];

  // ── Influencers ───────────────────────────────────────
  const influencers = [
    { name: "Tanmay Bhat",         handle: "@tanmaybhat",     platform: "Instagram", tier: "Macro",  followers: "4.2M", product: "Whey Choc 1kg",   format: "Reel",  spend: 320000, boost: 80000, views: 1840000, engagement: "4.2%", coupon: "TANMAY10", attribRev: 980000 },
    { name: "Rebecca Pinto",       handle: "@rebecca.pinto",  platform: "Instagram", tier: "Micro",  followers: "186K", product: "Biotin+Hair",     format: "Reel",  spend: 45000,  boost: 12000, views: 412000,  engagement: "6.8%", coupon: "REBECCA15",attribRev: 240000 },
    { name: "Yatinder Singh",      handle: "@yatinder_singh", platform: "Instagram", tier: "Macro",  followers: "1.1M", product: "Whey Van 1kg",    format: "Post",  spend: 80000,  boost: 20000, views: 380000,  engagement: "3.4%", coupon: "YATI10",   attribRev: 320000 },
    { name: "Anushka Hegde",       handle: "@anushkahegde",   platform: "YouTube",   tier: "Micro",  followers: "212K", product: "Multivitamin W",  format: "Video", spend: 60000,  boost: 0,     views: 184000,  engagement: "5.1%", coupon: "ANU20",    attribRev: 410000 },
    { name: "Karan Singh",         handle: "@karansinghxd",   platform: "Instagram", tier: "Nano",   followers: "42K",  product: "Creatine",        format: "Story", spend: 8000,   boost: 0,     views: 28000,   engagement: "8.2%", coupon: null,       attribRev: null },
    { name: "Dr. Ananya Sharma",   handle: "@dr.ananyas",     platform: "Instagram", tier: "Micro",  followers: "320K", product: "Omega-3",         format: "Reel",  spend: 75000,  boost: 25000, views: 540000,  engagement: "5.6%", coupon: "ANANYA15", attribRev: 380000 },
    { name: "FitWithDev",          handle: "@fitwithdev",     platform: "YouTube",   tier: "Micro",  followers: "184K", product: "Whey Choc 2kg",   format: "Video", spend: 90000,  boost: 0,     views: 240000,  engagement: "4.4%", coupon: null,       attribRev: null },
  ];

  // ── Marketplace intel ─────────────────────────────────
  const marketplaceAmazon = [
    { sku: "NS-WHT-CHO-1K", asin: "B09KX2J4Q1", bsr: 142,  bsrPrev: 168,  cat: "Sports Nutrition", buyBox: "Winning", buyBoxRate: 96, listing: "Active",     rating: 4.5, reviews: 4820, ratingTrend: +0.1 },
    { sku: "NS-WHT-VAN-1K", asin: "B09KX2J4Q2", bsr: 184,  bsrPrev: 172,  cat: "Sports Nutrition", buyBox: "Winning", buyBoxRate: 92, listing: "Active",     rating: 4.4, reviews: 2940, ratingTrend: -0.1 },
    { sku: "NS-WHT-CHO-2K", asin: "B09KX2J4Q3", bsr: null, bsrPrev: 312,  cat: "Sports Nutrition", buyBox: "—",       buyBoxRate: 0,  listing: "Suppressed", rating: 4.5, reviews: 1840, ratingTrend: 0.0 },
    { sku: "NS-MUL-MEN-60", asin: "B0B7P92XK4", bsr: 38,   bsrPrev: 41,   cat: "Multivitamins",    buyBox: "Winning", buyBoxRate: 98, listing: "Active",     rating: 4.6, reviews: 8210, ratingTrend: 0.0 },
    { sku: "NS-MUL-WMN-60", asin: "B0B7P92XK5", bsr: 24,   bsrPrev: 28,   cat: "Multivitamins",    buyBox: "Winning", buyBoxRate: 99, listing: "Active",     rating: 4.7, reviews: 9420, ratingTrend: +0.1 },
    { sku: "NS-OMG-3-90",   asin: "B0C1MTH7QQ", bsr: 86,   bsrPrev: 92,   cat: "Supplements",      buyBox: "Winning", buyBoxRate: 94, listing: "Active",     rating: 4.5, reviews: 5180, ratingTrend: 0.0 },
    { sku: "NS-BIO-HAIR-60",asin: "B0C1MTH7QR", bsr: 12,   bsrPrev: 14,   cat: "Hair Care",        buyBox: "Winning", buyBoxRate: 97, listing: "Active",     rating: 4.6, reviews: 12480,ratingTrend: +0.1 },
    { sku: "NS-COL-PEP-250",asin: "B0C1MTH7QS", bsr: 220,  bsrPrev: 184,  cat: "Skin Care",        buyBox: "Losing",  buyBoxRate: 62, listing: "Active",     rating: 3.9, reviews: 2840, ratingTrend: -0.3 },
    { sku: "NS-ASH-500-60", asin: "B0C1MTH7QT", bsr: 54,   bsrPrev: 58,   cat: "Herbal",           buyBox: "Winning", buyBoxRate: 95, listing: "Active",     rating: 4.5, reviews: 3120, ratingTrend: 0.0 },
    { sku: "NS-PRO-VEG-1K", asin: "B0C1MTH7QU", bsr: 380,  bsrPrev: 412,  cat: "Sports Nutrition", buyBox: "Winning", buyBoxRate: 88, listing: "Active",     rating: 3.8, reviews: 612,  ratingTrend: -0.2 },
  ];

  const recentReviews = [
    { sku: "NS-COL-PEP-250", platform: "Amazon",   rating: 1, title: "Tastes chalky",            body: "Couldn't drink more than two days. The taste is really off, doesn't dissolve well either.", time: "4h ago" },
    { sku: "NS-COL-PEP-250", platform: "Amazon",   rating: 2, title: "Doesn't mix properly",     body: "Even in warm water there are clumps. Returning.", time: "11h ago" },
    { sku: "NS-WHT-VAN-1K",  platform: "Flipkart", rating: 5, title: "Best whey under 3K",       body: "Mixes well, tastes good, no bloating. Already on second tub.", time: "yesterday" },
    { sku: "NS-MUL-WMN-60",  platform: "Amazon",   rating: 5, title: "Felt the difference",      body: "Energy is back up. Hair fall reduced after week 3.", time: "yesterday" },
    { sku: "NS-COL-PEP-250", platform: "Amazon",   rating: 1, title: "Smells weird",             body: "Fishy smell, can't get past it. Money wasted.", time: "yesterday" },
    { sku: "NS-PRO-VEG-1K",  platform: "Amazon",   rating: 2, title: "Lumpy when mixed",         body: "Tried with water and milk, both end up lumpy. Disappointing for the price.", time: "2d ago" },
  ];

  // ── Finance ───────────────────────────────────────────
  const costCards = [
    { sku: "NS-WHT-CHO-1K", batch: "B-2503-WHT01", cogs: 480, packaging: 62, freight: 18, landed: 560, mrp: 1899 },
    { sku: "NS-WHT-VAN-1K", batch: "B-2503-WHT02", cogs: 478, packaging: 62, freight: 18, landed: 558, mrp: 1899 },
    { sku: "NS-MUL-WMN-60", batch: "B-2502-MUL-W", cogs: 142, packaging: 28, freight:  6, landed: 176, mrp:  699 },
    { sku: "NS-OMG-3-90",   batch: "B-2412-OMG3",  cogs: 168, packaging: 32, freight:  8, landed: 208, mrp:  799 },
    { sku: "NS-BIO-HAIR-60",batch: "B-2501-BIO",   cogs: 124, packaging: 28, freight:  6, landed: 158, mrp:  649 },
    { sku: "NS-COL-PEP-250",batch: "B-2410-COL",   cogs: 248, packaging: 42, freight: 12, landed: 302, mrp: 1199 },
    { sku: "NS-ASH-500-60", batch: "B-2504-ASH",   cogs:  92, packaging: 28, freight:  4, landed: 124, mrp:  499 },
  ];

  // P&L MTD (₹)
  const pnl = {
    revenue: { amazon: 11240000, shopify: 8420000, flipkart: 4820000, blinkit: 4460000 },
    cogs: -8640000,
    platformFees: { amazon: -1820000, flipkart: -680000, blinkit: -340000 },
    fulfillment: -1240000,
    adSpend: { google: -1840000, meta: -2120000 },
    influencer: -680000,
    overhead: -1640000, // Zoho synced
  };

  // Cash flow next 30 days (selected days)
  const cashflow = [
    { date: "May 21", inflow: 720000,  outflow: -180000, evt: "Shopify payout" },
    { date: "May 24", inflow: 320000,  outflow: -0,      evt: "Shopify payout" },
    { date: "May 25", inflow: 0,       outflow: -480000, evt: "Glanbia 70% balance" },
    { date: "May 27", inflow: 1820000, outflow: 0,       evt: "Amazon payout D+7" },
    { date: "May 30", inflow: 0,       outflow: -240000, evt: "Print Origin invoice" },
    { date: "Jun 02", inflow: 940000,  outflow: -0,      evt: "Flipkart payout" },
    { date: "Jun 04", inflow: 0,       outflow: -1240000, evt: "Lonza Net 30 + DSM" },
    { date: "Jun 07", inflow: 2140000, outflow: 0,       evt: "Amazon payout D+7" },
    { date: "Jun 10", inflow: 0,       outflow: -680000, evt: "Influencer payouts" },
    { date: "Jun 14", inflow: 1280000, outflow: -1080000, evt: "Blinkit · Arjuna PO" },
    { date: "Jun 17", inflow: 2280000, outflow: 0,       evt: "Amazon payout" },
  ];

  // ── Launches ──────────────────────────────────────────
  const launches = [
    {
      id: "L01", name: "Magnesium Glycinate · 60ct", sku: "NS-MAG-GLY-60", phase: "pre", target: "Aug 14, 2026", progress: 62,
      milestones: [
        { name: "Concept & formulation finalized",         owner: "Cristoo",   start: 0,  end: 6,  status: "done"     },
        { name: "Lab testing complete (FSSAI/safety)",     owner: "Kirat",     start: 6,  end: 18, status: "done"     },
        { name: "Packaging design approved",               owner: "Design",    start: 12, end: 24, status: "done"     },
        { name: "Packaging material procured",             owner: "Ops",       start: 22, end: 36, status: "progress" },
        { name: "Raw materials procured",                  owner: "Ops",       start: 24, end: 38, status: "progress" },
        { name: "Production / manufacturing complete",     owner: "Ops",       start: 38, end: 52, status: "notstarted" },
        { name: "Inventory received at main warehouse",    owner: "Ops",       start: 52, end: 58, status: "notstarted" },
        { name: "Listing copy written",                    owner: "Marketing", start: 30, end: 44, status: "delayed"  },
        { name: "Listing creatives ready (A+ / EBC)",      owner: "Design",    start: 38, end: 56, status: "notstarted" },
        { name: "Ad creatives ready",                      owner: "Agency",    start: 44, end: 60, status: "notstarted" },
        { name: "Amazon / Flipkart listing live",          owner: "Marketplace", start: 60, end: 64, status: "notstarted" },
        { name: "Shopify product page live",               owner: "Marketing", start: 60, end: 64, status: "notstarted" },
        { name: "Launch date confirmed",                   owner: "Cristoo",   start: 64, end: 68, status: "notstarted" },
        { name: "Blinkit / Instamart onboarding",          owner: "Marketplace", start: 64, end: 78, status: "notstarted" },
      ]
    },
    {
      id: "L02", name: "Zinc + Vitamin C · Effervescent · 20ct", sku: "NS-ZNC-EFF-20", phase: "pre", target: "Sep 10, 2026", progress: 18,
      milestones: [
        { name: "Concept & formulation finalized",         owner: "Cristoo",   start: 0,  end: 14, status: "progress" },
        { name: "Lab testing complete (FSSAI/safety)",     owner: "Kirat",     start: 14, end: 28, status: "notstarted" },
      ]
    },
    {
      id: "L03", name: "Pre-Probiotic Gut Health · 30ct", sku: "NS-PRE-GUT-30", phase: "post", target: "Live · D+34", progress: 100,
      milestones: [],
      live: { d1: 84, d7: 312, d14: 540, d30: 980, d60: null, d90: null, targets: { d1: 60, d7: 400, d14: 800, d30: 1500 } },
    },
  ];

  return {
    fmtINR, fmtN, pct,
    skus, channels, revenueToday, revenueYesterday, revenueMTD, revenueMTDLast, revenueMTDTarget,
    revenue7dAvg, cashExpected,
    trend30, alerts, skuSales, inventory, batches, suppliers, poLog,
    adAccounts, googleCampaigns, metaCampaigns, influencers,
    marketplaceAmazon, recentReviews,
    costCards, pnl, cashflow, launches,
  };
})();


if (typeof window !== 'undefined') window.NSData = NSData;
export default NSData;
