// Every product claim on the page comes from the root README.md and docs/architecture/overview.md; change them
// together. Commands, flags, paths, and format names stay in English in every locale.

export const en = {
  meta: {
    title: 'Estela: see what the model saw at every request',
    description:
      'A local viewer for agent sessions. A request timeline, an event ledger, list cost, and the context each request received, rebuilt from the logs on your machine.',
  },
  nav: {
    label: 'Primary',
    skip: 'Skip to content',
    features: 'Features',
    demo: 'Demo',
    agents: 'Agents',
    privacy: 'Privacy',
    docs: 'Docs',
    language: 'Language',
    footer: 'Footer',
    themeToDark: 'Switch to the dark theme',
    themeToLight: 'Switch to the light theme',
  },
  hero: {
    eyebrow: 'A local viewer for agent sessions',
    // The space between the two parts belongs to the language: English has one, Chinese none.
    titleLead: 'See what the model saw ',
    titleTail: 'at every request.',
    lead: 'Estela brings the agent sessions on your machine into one local interface: a request timeline, an event ledger, and token counts for each session, and for each request the context the model received.',
    copy: 'Copy the command',
    copied: 'Copied',
    demo: 'Open the live demo',
    source: 'Source on GitHub',
    facts: ['Node.js 24 or later', 'Binds localhost by default', 'Reads logs, never writes them', 'GPL-3.0-only'],
    scene: {
      label:
        'A session drawn as Estela draws it: one bar per request, its height the input tokens. The context grows, a compaction cuts it, and two subagent lanes branch off the main lane.',
      sample: 'Sample session',
      context: 'Input tokens per request',
      compaction: 'Compaction',
      lane: 'Subagent lane',
      selected: 'Model saw',
    },
  },
  answers: {
    eyebrow: 'What it answers',
    title: 'A log tells you what happened. Estela shows what the model was working with.',
    items: [
      {
        id: 'saw',
        question: 'What did the model see at this request?',
        answer:
          'Pick any request and Estela rebuilds the context it received: system prompt, tools, messages, and the events a compaction removed. A slot the log never recorded is marked unavailable. Nothing is estimated.',
      },
      {
        id: 'compaction',
        question: 'What did the compaction remove?',
        answer:
          'A compaction is a dashed rule with the token count before and after. Model saw lists the events it dropped, and Compare shows what entered and left the context between any two requests of a lane.',
      },
      {
        id: 'tokens',
        question: 'Where did the tokens and the money go?',
        answer:
          'The timeline draws one bar per request, its height the input tokens, with markers for prompts, failed tool calls, and compactions. Each request, turn, subagent, and session shows the list price of its recorded tokens; a request the log cannot price is marked unavailable.',
      },
      {
        id: 'lanes',
        question: 'What did each subagent do?',
        answer:
          'Every subagent gets its own lane in the timeline. The ledger groups events by turn, or by agent with one header per agent.',
      },
    ],
    figure: {
      system: 'System prompt',
      tools: 'Tools',
      messages: 'Messages',
      removed: 'Removed by compaction',
      unavailable: 'unavailable',
      request: 'Request',
      prompt: 'Prompt',
      failed: 'Failed tool call',
      main: 'main',
      subagent: 'subagent',
    },
  },
  demo: {
    eyebrow: 'Live demo',
    title: 'A real report, not a screenshot.',
    lead: 'This is the file the build command writes from the bundled demo trace: one redacted index.html that opens with no server. Click a request to see what the model saw.',
    open: 'Open the demo in a new tab',
    frame: 'Estela report of the bundled demo trace',
    small: 'The report is a desktop tool. Open it on a wider screen, or in a new tab here.',
  },
  commands: {
    eyebrow: 'One command',
    title: 'Run it, then pick a session.',
    lead: 'It starts a server on localhost:7392, opens the browser, and indexes the sessions of the supported agents. A path opens that session directly.',
    rows: [
      { command: 'npx @rivus/estela', what: 'Session browser for this machine.' },
      { command: 'npx @rivus/estela <path>', what: 'Loads that session, then opens its workspace.' },
      { command: 'npx @rivus/estela --pick', what: 'Searchable session list in the terminal.' },
      {
        command: 'npx @rivus/estela build <path>',
        what: 'Writes the report of one session to one index.html.',
      },
      { command: 'npx @rivus/estela mcp', what: 'MCP server over stdio: seven read-only tools over every session.' },
    ],
  },
  elsewhere: {
    eyebrow: 'Take a session elsewhere',
    title: 'Export, or ask from another agent.',
    items: [
      {
        name: 'ATIF v1.8',
        command: 'npx @rivus/estela export-atif <path>',
        body: 'One trajectory for Harbor datasets and evaluation. Each step names the canonical events it came from.',
      },
      {
        name: 'OTLP/JSON',
        command: 'npx @rivus/estela export-otlp <path>',
        body: 'One ExportTraceServiceRequest whose spans carry the OpenTelemetry GenAI attributes, for Langfuse, LangSmith, and Phoenix.',
      },
      {
        name: 'MCP',
        command: 'npx @rivus/estela mcp',
        body: 'Seven read-only tools over stdio, so an agent can find an earlier session and read what its model saw at a request.',
      },
    ],
  },
  agents: {
    eyebrow: 'Supported agents',
    title: 'Seven agents, found where they keep their sessions.',
    lead: "Each agent's home override applies. A folder that does not exist shows 0 sessions and the path it checked; a file that cannot be parsed is listed with the file, line, and reason.",
    grok: 'Grok records token usage per turn, so a Grok session has one request per turn.',
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Your sessions stay on your machine.',
    items: [
      {
        title: 'Local only',
        body: 'Everything runs on this machine. The server binds localhost, and nothing is sent anywhere.',
      },
      { title: 'Read-only', body: 'Session files are read, never written. URLs carry opaque trace ids, never paths.' },
      {
        title: 'Redacted',
        body: 'The local server replaces the home directory with ~ and a fixed set of token shapes with placeholders. Other secrets pass through.',
      },
      {
        title: 'Reports are always redacted',
        body: 'Session text and file contents remain in a report, so read it before you share it.',
      },
      {
        title: 'A disposable index',
        body: 'Titles, paths, numbers, and your prompts for search, stored unredacted in a 0600 cache file. Delete it any time, or run with --no-index.',
      },
    ],
  },
  docs: {
    eyebrow: 'Docs and source',
    title: 'Read further.',
    links: [
      { id: 'readme', label: 'README', body: 'What it is, the one command, and the supported agents.' },
      {
        id: 'guide',
        label: 'User guide',
        body: 'Concepts, the workspace, exports, MCP, privacy, and troubleshooting.',
      },
      { id: 'reference', label: 'Reference', body: 'Public interface, MCP tools, and export formats.' },
      { id: 'architecture', label: 'Architecture', body: 'Current behavior and the shape of the system.' },
      { id: 'design', label: 'Visual design', body: 'Screens, tokens, and the encoding rules.' },
      { id: 'contributing', label: 'Contributing', body: 'Workflow, change gates, and release intent.' },
    ],
  },
  docsSidebar: {
    guide: 'Guide',
    reference: 'Reference',
    design: 'Visual design',
    fallbackNotice: 'This page has no Chinese translation yet; the English original follows.',
    loadErrorNotice: 'Could not load the Chinese version of this page.',
    retry: 'Retry',
  },
  footer: {
    wake: 'Estela is Spanish for a wake: the trail a ship leaves on the water. A session log is the trail an agent leaves behind, and Estela reads it.',
    license: 'GPL-3.0-only',
    changelog: 'Changelog',
    security: 'Security',
  },
}

export type Dictionary = typeof en
