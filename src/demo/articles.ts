export interface DemoRawArticle {
  id: string;
  title: string;
  dek: string;
  url: string;
  image: string;
  date: string;
  byline: string;
  section: string;
  keywords: string[];
  audiences: string[];
  body: string;
}

const image = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=82`;

export const demoArticles: DemoRawArticle[] = [
  {
    id: 'quiet-revolution-electric-ferries', title: 'The quiet revolution taking electric ferries to open water',
    dek: 'A new generation of marine engineers is making short sea journeys cleaner without asking passengers to change how they travel.',
    url: 'https://demo.publisher.example/articles/quiet-revolution-electric-ferries', image: image('photo-1544551763-46a013bb70d5'), date: '2026-09-18', byline: 'Mara Ellis', section: 'Sustainability', keywords: ['sustainability', 'technology', 'manufacturing', 'transport'], audiences: ['manufacturer', 'executive'], body: 'European boatbuilders are pairing battery systems with lighter composite hulls to make practical electric ferries for regional routes.',
  },
  {
    id: 'european-yards-hybrid-propulsion', title: 'European yards accelerate adoption of hybrid propulsion systems',
    dek: 'Boatbuilders are pairing electric motors with efficient combustion systems as marine markets look for practical routes to lower emissions.',
    url: 'https://demo.publisher.example/articles/european-yards-hybrid-propulsion', image: image('photo-1500534623283-312aade485b7'), date: '2026-09-22', byline: 'Mara Ellis', section: 'Making', keywords: ['hybrid propulsion', 'marine', 'boatbuilders', 'decarbonisation'], audiences: ['manufacturer', 'executive'], body: 'European yards are investing in hybrid propulsion systems, dealer training and alternative powertrains as customers ask for cleaner leisure boats.',
  },
  {
    id: 'materials-that-learn', title: 'Can materials that learn make manufacturing more resilient?',
    dek: 'From adaptive alloys to self-monitoring components, the factory floor is becoming a place where materials report back.',
    url: 'https://demo.publisher.example/articles/materials-that-learn', image: image('photo-1565793298595-6a879b1d9492'), date: '2026-09-11', byline: 'Jon Bell', section: 'Technology', keywords: ['technology', 'manufacturing', 'materials', 'innovation'], audiences: ['manufacturer', 'developer'], body: 'Researchers and manufacturers are testing materials that can sense stress, helping production teams reduce waste and anticipate maintenance.',
  },
  {
    id: 'city-heat-islands', title: 'The neighbourhoods redesigning themselves for extreme heat',
    dek: 'Shade, water and clever building choices are giving city residents new ways to live with hotter summers.',
    url: 'https://demo.publisher.example/articles/city-heat-islands', image: image('photo-1477959858617-67f85cf4f1df'), date: '2026-09-05', byline: 'Nadia Okafor', section: 'Climate', keywords: ['sustainability', 'science', 'cities', 'climate'], audiences: ['curious-reader', 'executive'], body: 'Urban designers are combining tree canopies, reflective surfaces and public cooling spaces to make dense neighbourhoods safer in heat.',
  },
  {
    id: 'repair-economy', title: 'The repair economy is finding its second act',
    dek: 'A culture of maintenance is spreading from local workshops into the boardrooms of the companies that make our things.',
    url: 'https://demo.publisher.example/articles/repair-economy', image: image('photo-1581091226825-a6a2a5aee158'), date: '2026-08-29', byline: 'Theo March', section: 'Business', keywords: ['sustainability', 'business', 'manufacturing', 'circular economy'], audiences: ['executive', 'manufacturer'], body: 'Product makers are exploring repair networks, spare-part design and longer warranties as both a business strategy and a sustainability measure.',
  },
  {
    id: 'small-language-models', title: 'Why small language models are having a big year',
    dek: 'The most useful AI systems may be the ones that run quietly, locally and with a much smaller appetite for energy.',
    url: 'https://demo.publisher.example/articles/small-language-models', image: image('photo-1518770660439-4636190af475'), date: '2026-08-21', byline: 'Priya Shah', section: 'Technology', keywords: ['technology', 'ai', 'software', 'energy'], audiences: ['developer', 'student', 'executive'], body: 'A new wave of compact language models is giving developers more control over cost, latency and the data that stays close to the user.',
  },
  {
    id: 'future-of-public-libraries', title: 'The future of the public library is being built in plain sight',
    dek: 'Libraries are becoming studios, classrooms and warm places to spend time together — without losing the quiet.',
    url: 'https://demo.publisher.example/articles/future-of-public-libraries', image: image('photo-1507842217343-583bb7270b66'), date: '2026-08-14', byline: 'Ari Cohen', section: 'Culture', keywords: ['culture', 'community', 'education', 'cities'], audiences: ['student', 'curious-reader'], body: 'Across Europe, librarians and architects are rethinking public space around access, learning and the simple social value of being welcome somewhere.',
  },
  {
    id: 'farming-with-less-water', title: 'Farming with less water, one field at a time',
    dek: 'Sensors and centuries-old knowledge are meeting in farms adapting to a drier climate.',
    url: 'https://demo.publisher.example/articles/farming-with-less-water', image: image('photo-1500937386664-56d1dfef3854'), date: '2026-08-08', byline: 'Mara Ellis', section: 'Science', keywords: ['sustainability', 'science', 'climate', 'agriculture'], audiences: ['manufacturer', 'curious-reader'], body: 'Farmers are combining soil sensors, crop diversity and careful irrigation to protect yields while reducing pressure on freshwater systems.',
  },
  {
    id: 'new-maps-of-ocean-life', title: 'The new maps revealing life below the ocean surface',
    dek: 'A growing library of underwater observations is changing what scientists know about fragile marine ecosystems.',
    url: 'https://demo.publisher.example/articles/new-maps-of-ocean-life', image: image('photo-1469474968028-56623f02e42e'), date: '2026-07-31', byline: 'Nadia Okafor', section: 'Science', keywords: ['science', 'technology', 'ocean', 'climate'], audiences: ['student', 'developer', 'curious-reader'], body: 'Autonomous instruments are giving marine scientists a clearer view of changing habitats and the species that depend on them.',
  },
  {
    id: 'work-after-the-office', title: 'What work looks like after the office',
    dek: 'The question is no longer whether work will change, but which parts of working life are worth designing around.',
    url: 'https://demo.publisher.example/articles/work-after-the-office', image: image('photo-1497366754035-f200968a6e72'), date: '2026-07-23', byline: 'Jon Bell', section: 'Business', keywords: ['business', 'work', 'technology', 'culture'], audiences: ['executive', 'developer'], body: 'Leaders are experimenting with hybrid rituals, smaller spaces and clearer measures of output as teams learn to work across distance.',
  },
  {
    id: 'designing-for-reuse', title: 'Designing for reuse is harder — and more interesting — than recycling',
    dek: 'The next generation of products will need to be taken apart as thoughtfully as they were put together.',
    url: 'https://demo.publisher.example/articles/designing-for-reuse', image: image('photo-1497366811353-6870744d04b2'), date: '2026-07-16', byline: 'Theo March', section: 'Making', keywords: ['sustainability', 'design', 'manufacturing', 'materials'], audiences: ['manufacturer', 'student'], body: 'Designers are working backwards from repair, remanufacture and reuse to create products whose materials can stay in circulation longer.',
  },
  {
    id: 'sleep-and-the-modern-city', title: 'How the modern city is learning to sleep',
    dek: 'From quieter streets to better lighting, urban health researchers are treating rest as infrastructure.',
    url: 'https://demo.publisher.example/articles/sleep-and-the-modern-city', image: image('photo-1517248135467-4c7edcad34c4'), date: '2026-07-09', byline: 'Ari Cohen', section: 'Health', keywords: ['health', 'cities', 'science', 'design'], audiences: ['curious-reader', 'executive'], body: 'Researchers are studying noise, light and travel patterns to understand how city design can help people get more restorative sleep.',
  },
  {
    id: 'robotics-in-the-workshop', title: 'The collaborative robots finding their place in the workshop',
    dek: 'Small manufacturers are using adaptable machines to handle repetitive tasks while keeping craft and judgement in human hands.',
    url: 'https://demo.publisher.example/articles/robotics-in-the-workshop', image: image('photo-1485827404703-89b55fcc595e'), date: '2026-06-28', byline: 'Priya Shah', section: 'Technology', keywords: ['technology', 'manufacturing', 'robotics', 'business'], audiences: ['manufacturer', 'developer'], body: 'Collaborative robots are helping smaller workshops automate repetitive processes without replacing the human knowledge that guides quality.',
  },
  {
    id: 'food-waste-new-business', title: 'The new businesses turning food waste into a resource',
    dek: 'Entrepreneurs are finding value in the overlooked streams that sit between farm, kitchen and landfill.',
    url: 'https://demo.publisher.example/articles/food-waste-new-business', image: image('photo-1498837167922-ddd27525d352'), date: '2026-06-20', byline: 'Mara Ellis', section: 'Business', keywords: ['sustainability', 'business', 'food', 'innovation'], audiences: ['executive', 'curious-reader'], body: 'New businesses are building logistics and processing systems that keep edible food in use and turn unavoidable waste into useful materials.',
  },
  {
    id: 'the-case-for-curiosity', title: 'The case for curiosity as a civic skill',
    dek: 'As public conversations grow more complex, asking better questions may be one of the most practical forms of participation.',
    url: 'https://demo.publisher.example/articles/the-case-for-curiosity', image: image('photo-1529156069898-49953e39b3ac'), date: '2026-06-12', byline: 'Nadia Okafor', section: 'Ideas', keywords: ['culture', 'community', 'education'], audiences: ['student', 'curious-reader'], body: 'Teachers, organisers and researchers are exploring how curiosity helps people navigate disagreement and make room for new evidence.',
  },
  {
    id: 'carbon-accounting-reality', title: 'What carbon accounting can — and cannot — tell us',
    dek: 'Better numbers are useful, but only when organisations are honest about the choices behind them.',
    url: 'https://demo.publisher.example/articles/carbon-accounting-reality', image: image('photo-1454165804606-c3d57bc86b40'), date: '2026-06-04', byline: 'Theo March', section: 'Business', keywords: ['sustainability', 'business', 'climate', 'data'], audiences: ['executive', 'developer'], body: 'Accountants and climate researchers are making emissions reporting more useful by clarifying boundaries, assumptions and the decisions data can support.',
  },
  {
    id: 'learning-to-live-with-water', title: 'Learning to live with water instead of fighting it',
    dek: 'A new generation of landscape projects is giving rivers room to move through the places we build.',
    url: 'https://demo.publisher.example/articles/learning-to-live-with-water', image: image('photo-1437482078695-73f5ca6c96e2'), date: '2026-05-27', byline: 'Ari Cohen', section: 'Climate', keywords: ['sustainability', 'climate', 'design', 'cities'], audiences: ['manufacturer', 'curious-reader'], body: 'Landscape architects are restoring wetlands and designing public spaces that can safely hold water, reducing risk while improving everyday life.',
  },
  {
    id: 'open-source-observatories', title: 'The open-source observatories watching the sky',
    dek: 'Amateur astronomers and professional researchers are building a shared picture of a changing night sky.',
    url: 'https://demo.publisher.example/articles/open-source-observatories', image: image('photo-1444703686981-a3abbc4d4fe3'), date: '2026-05-18', byline: 'Priya Shah', section: 'Science', keywords: ['science', 'technology', 'space', 'community'], audiences: ['developer', 'student', 'curious-reader'], body: 'Open tools and distributed sensors are helping more people contribute observations that researchers can use to study objects beyond Earth.',
  },
  {
    id: 'craft-of-long-projects', title: 'The craft of finishing a long project',
    dek: 'What happens when a team gives an ambitious idea enough time to become useful?',
    url: 'https://demo.publisher.example/articles/craft-of-long-projects', image: image('photo-1456324504439-367cee3b3c32'), date: '2026-05-10', byline: 'Jon Bell', section: 'Making', keywords: ['culture', 'business', 'design', 'work'], audiences: ['executive', 'student'], body: 'Builders and makers describe the habits that help complex work survive changing priorities, setbacks and the slow middle of a project.',
  },
];
