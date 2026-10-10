// Every word on the page lives in this file. Change the text here; the 3D room follows.

export const content = {
  // Your name, e.g. 'Jane Doe'. Leave empty to show the role instead.
  name: 'Max Li',
  role: 'AI & Full-Stack Developer',
  // Optional round photo next to the name and in the contact window, e.g. 'images/me.jpg'.
  photo: 'images/avatar.jpg',

  hero: {
    status: 'Available for new projects',
    title: ['I turn AI ideas into', 'working products.'], // the second part gets the colour gradient
    text: 'Every workstation in this lab runs one part of what I build. Switch one on.',
    primary: 'Let’s talk',
    secondary: 'Boot all',
    hint: 'Click a workstation to boot it · scroll or use ← → to move on',
    hintTouch: 'Tap the workstation to boot it · swipe for the next one',
  },

  // One entry per thing you can open in the lab. Entries become workstations, split between the
  // left and right wing in this order (the design holds up to six, eight at most). The entry
  // marked `core: true` is not a workstation: it is the AI core at the top of the steps.
  //   label  – short name on its tag, its standby screen and in the bottom bar
  //   screen – what a workstation shows when it is on, and the sign that floats above it:
  //            'chat' | 'search' | 'agents' | 'gauge' | 'stack' | 'steps' | 'mail'
  //   points – lines in the text window; text before a colon is shown in bold
  machines: [
    {
      id: 'llm',
      label: 'LLM apps',
      screen: 'chat',
      title: 'LLM apps & chatbots',
      text: 'Assistants that answer from your own data, with streaming replies, memory and guardrails.',
      points: [
        'Grounded: answers come from your content, not from guesses',
        'Fast: replies stream in as they are written',
        'Safe: guardrails keep tone, scope and privacy in check',
      ],
      tags: ['OpenAI', 'Claude', 'Gemini'],
    },
    {
      id: 'rag',
      label: 'RAG search',
      screen: 'search',
      title: 'RAG & knowledge search',
      text: 'Document pipelines, embeddings and vector search, so answers come with sources instead of guesses.',
      points: [
        'Ingestion: PDFs, docs and web pages cleaned and split',
        'Retrieval: embeddings with keyword and vector search together',
        'Citations: every answer points to where it came from',
      ],
      tags: ['Embeddings', 'pgvector', 'LangChain'],
    },
    {
      id: 'agents',
      label: 'AI agents',
      screen: 'agents',
      title: 'AI agents & automation',
      text: 'Agents that call tools, fill in forms and move work between your systems while a person stays in control.',
      points: [
        'Tools: the agent calls your APIs, CRM and email',
        'Workflows: multi-step jobs with retries and checks',
        'Oversight: a person approves the steps that matter',
      ],
      tags: ['Tool calling', 'LangGraph', 'n8n'],
    },
    {
      id: 'evals',
      label: 'Evaluation',
      screen: 'gauge',
      title: 'Evaluation & cost control',
      text: 'Test sets, tracing and caching, so quality is measured and the monthly bill stays predictable.',
      points: [
        'Test sets: changes are scored before they ship',
        'Tracing: every request can be followed end to end',
        'Cost: caching and model routing keep spend down',
      ],
      tags: ['Evals', 'Tracing', 'Caching'],
    },
    {
      id: 'stack',
      label: 'Full-stack',
      screen: 'stack',
      title: 'The whole product, not only the model',
      text: 'An AI feature pays off inside a product people can sign in to, pay for and rely on. I build that product too.',
      points: [
        'Interface: React, Next.js, TypeScript, Tailwind CSS, Three.js',
        'API & services: Node.js, Python, FastAPI, REST, WebSockets',
        'Data: PostgreSQL, Redis, vector databases',
        'Cloud & delivery: Docker, AWS, Vercel, CI/CD',
      ],
      tags: [],
    },
    {
      id: 'process',
      label: 'Process',
      screen: 'steps',
      title: 'From idea to production in four steps',
      text: 'A simple path that keeps risk low: you see something working early, and every later step rests on what real use shows.',
      points: [
        '01 Understand: what the AI should do, for whom, and how we will know it works',
        '02 Prototype: a working demo on your real data early on',
        '03 Build: accounts, database, tests and a clean interface',
        '04 Ship & improve: go live, watch real usage, tune quality, speed and cost',
      ],
      tags: [],
    },
    {
      id: 'contact',
      label: 'Contact',
      core: true,
      title: 'Have an AI idea? Let’s build it.',
      text: 'Tell me what you want the AI to do and what data you have. I’ll reply with a plan, a timeline and an honest view of what is realistic.',
      points: [],
      tags: [],
      email: 'nightfairy5831@gmail.com',
      // Extra buttons, e.g. { label: 'Upwork', url: 'https://www.upwork.com/freelancers/…' }
      links: [],
    },
  ],
};
