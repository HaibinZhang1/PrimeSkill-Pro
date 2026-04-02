export interface DemoSkillCatalogItem {
  skillId: number;
  skillVersionId: number;
  name: string;
  summary: string;
  category: string;
  supportedTools: string[];
  tags: string[];
  recommendedInstallMode: 'global' | 'project';
  installCount: number;
}

export const demoSkillCatalog: DemoSkillCatalogItem[] = [
  {
    skillId: 9001,
    skillVersionId: 9101,
    name: 'API Contract Assistant',
    summary: 'Generate OpenAPI drafts, contract checklists, and release-ready endpoint notes for service teams.',
    category: 'Engineering Delivery',
    supportedTools: ['Cursor', 'Codex'],
    tags: ['api', 'backend', 'contracts'],
    recommendedInstallMode: 'project',
    installCount: 284
  },
  {
    skillId: 9002,
    skillVersionId: 9102,
    name: 'Bug Triage Copilot',
    summary: 'Turn crash reports and issue threads into reproducible bug notes, severity tags, and next-step suggestions.',
    category: 'Incident Response',
    supportedTools: ['Cursor', 'Cline'],
    tags: ['debugging', 'triage', 'ops'],
    recommendedInstallMode: 'project',
    installCount: 198
  },
  {
    skillId: 9003,
    skillVersionId: 9103,
    name: 'Research Snapshot Builder',
    summary: 'Summarize documents, compare competitors, and prepare briefings that can be shared with product stakeholders.',
    category: 'Product Research',
    supportedTools: ['Codex', 'OpenCode'],
    tags: ['research', 'analysis', 'strategy'],
    recommendedInstallMode: 'global',
    installCount: 143
  },
  {
    skillId: 9004,
    skillVersionId: 9104,
    name: 'Prompt QA Reviewer',
    summary: 'Review prompt packs for regressions, missing guardrails, and rollout risks before publishing to teams.',
    category: 'Prompt Governance',
    supportedTools: ['Codex', 'Cline'],
    tags: ['prompting', 'review', 'quality'],
    recommendedInstallMode: 'project',
    installCount: 87
  },
  {
    skillId: 9005,
    skillVersionId: 9105,
    name: 'Frontend Ship Checklist',
    summary: 'Produce UX acceptance notes, launch checklists, and responsive QA prompts for feature delivery.',
    category: 'Frontend Delivery',
    supportedTools: ['Cursor', 'OpenCode'],
    tags: ['frontend', 'qa', 'release'],
    recommendedInstallMode: 'project',
    installCount: 231
  },
  {
    skillId: 9006,
    skillVersionId: 9106,
    name: 'Knowledge Base Curator',
    summary: 'Convert scattered docs into reusable knowledge blocks, FAQs, and onboarding snippets for internal teams.',
    category: 'Knowledge Ops',
    supportedTools: ['Codex', 'OpenCode', 'Cursor'],
    tags: ['docs', 'knowledge', 'onboarding'],
    recommendedInstallMode: 'global',
    installCount: 164
  }
];
