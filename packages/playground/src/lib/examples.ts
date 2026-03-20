export interface Example {
  name: string;
  description: string;
  source: string;
  recommendedTarget: string;
}

export const EXAMPLES: Example[] = [
  {
    name: 'Dashboard',
    description: 'Fitness tracker with progress bars and meal list',
    recommendedTarget: 'tailwind',
    source: `screen name=Dashboard {bg:#0A0F1C}
  row {p:16,jc:sb,ai:center}
    text value=FITVT {fs:24,fw:bold,c:#F8FAFC}
    image src=avatar {w:40,h:40,br:20}
  card {p:20,br:16,bg:#232D3F,m:16}
    progress label=Calories current=1840 target=2200 unit=kcal color=#3B82F6
    progress label=Protein current=96 target=140 unit=g color=#EF4444
    progress label=Carbs current=210 target=260 unit=g color=#22C55E
    progress label=Fat current=58 target=70 unit=g color=#F59E0B
  button text="Log Meal" to=LogMeal {w:full,br:12,bg:#8B5CF6,p:16,c:#fff,:press:bg:#7C3AED}
  list title="Recent Meals" separator=true
    item id=m1 name="Greek Yogurt Bowl" time=08:15 calories=320
    item id=m2 name="Chicken Salad" time=12:40 calories=540
    item id=m3 name="Protein Shake" time=15:10 calories=220
  tabs active=Dashboard
    tab icon=home label=Dashboard
    tab icon=plus label=Log
    tab icon=chart label=Stats`,
  },
  {
    name: 'API Routes',
    description: 'Express server with REST endpoints',
    recommendedTarget: 'express',
    source: `server name=MusicAPI port=3001
  middleware name=cors
  middleware name=json
  middleware name=auth handler=verifyToken

  route method=get path=/api/tracks
    handler <<<
      const tracks = await db.tracks.findAll({ userId: req.user.id });
      res.json(tracks);
    >>>

  route method=post path=/api/tracks/analyze
    schema body="{trackId: string, options?: {stems: boolean}}"
    handler <<<
      const { trackId, options } = req.body;
      const result = await analyzeTrack(trackId, options);
      res.json(result);
    >>>

  route method=get path=/api/tracks/:id
    handler <<<
      const track = await db.tracks.findById(req.params.id);
      if (!track) return res.status(404).json({ error: 'Not found' });
      res.json(track);
    >>>`,
  },
  {
    name: 'Landing Page',
    description: 'Next.js marketing page with hero and features',
    recommendedTarget: 'nextjs',
    source: `page name=LandingPage client=true {bg:#09090b}
  metadata title="SoundKit — Audio Toolkit" description="Analyze your mix with AI-powered stem separation." keywords="audio,mixing,mastering,AI"

  row {jc:sb,ai:center,p:16,border:#27272a}
    link to=/
      text value=SoundKit tag=h1 {fs:24,fw:bold,c:#fff}
    row {gap:16,ai:center}
      link to=/features
        text value=Features {fs:14,c:#a1a1aa}
      link to=/pricing
        text value=Pricing {fs:14,c:#a1a1aa}
      button text="Get Started" to=signup {bg:#f97316,c:#fff,br:8,p:12}

  col {ai:center,p:80,gap:24}
    text value="Analyze your mix in seconds" tag=h1 {fs:48,fw:800,c:#fff,ta:center}
    text value="AI-powered stem separation and frequency analysis." tag=p {fs:18,c:#a1a1aa,ta:center}
    row {gap:16}
      button text="Start Free Trial" to=signup {bg:#f97316,c:#fff,br:8,p:16,fs:16,fw:600}
      button text="Watch Demo" onClick=openDemo {bg:transparent,c:#fff,br:8,p:16,fs:16,fw:600,border:#3f3f46}

  grid cols=3 gap=32 {p:32}
    card {bg:#18181b,br:16,p:24,border:#27272a}
      text value="Stem Separation" tag=h3 {fs:18,fw:600,c:#fff,mb:8}
      text value="Split any track into drums, bass, vocals, and more." tag=p {fs:14,c:#a1a1aa}
    card {bg:#18181b,br:16,p:24,border:#27272a}
      text value="Frequency Analysis" tag=h3 {fs:18,fw:600,c:#fff,mb:8}
      text value="Identify problematic frequencies and get EQ suggestions." tag=p {fs:14,c:#a1a1aa}`,
  },
  {
    name: 'Interactive Search',
    description: 'Stateful UI with debounced search',
    recommendedTarget: 'tailwind',
    source: `screen name=InteractiveSearch {p:24,bg:#F8F9FA}
  state name=query initial=""
  state name=loading initial=true
  state name=items initial={{ [] }}

  col {gap:16}
    text value="Search Inventory" {fs:24,fw:bold,c:#18181b}
    text value="Type a product name to filter the live results." tag=p {fs:14,c:#52525b}
    input bind=query placeholder="Search items..." {p:12,br:8,bg:#fff,border:#d4d4d8}
    row {jc:sb,ai:center}
      text value={{ loading ? "Refreshing..." : "Ready" }} {fs:14,c:#18181b}
      text value={{ query.length > 0 ? "Filter: " + query : "All items" }} {fs:14,c:#71717a}
    list separator=true
      item id=m1 name="Apple Watch" category=Electronics
      item id=m2 name="Bluetooth Speaker" category=Audio
      item id=m3 name="Desk Lamp" category=Office`,
  },
];
