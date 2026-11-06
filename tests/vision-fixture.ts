import type { ProjectVisionData } from '../shared/schema';
export const visionFixture: ProjectVisionData = {
  name: 'Job Lantern',
  nameMeaning: 'Makes project progress visible.',
  nameStatus: 'confirmed',
  originalIdea: 'A web system for renovation teams and their clients.',
  summary: 'Keep clients informed without repeated status calls.',
  purpose: 'Clear communication',
  audience: 'Small renovation teams and clients',
  projectType: 'Web system',
  platforms: 'Desktop and mobile browsers',
  coreExperience: 'Open a job and review progress photos and next steps.',
  essentialFeatures: 'Job timeline, progress updates, client access',
  exclusions: 'Payments and accounting',
  creativePillars: 'Clear, reassuring, practical',
  visualDirection: 'Warm editorial typography and restrained color',
  constraints: 'Small initial scope',
  confirmedDecisions: 'One timeline per job',
  assumptions: 'Clients use a shared link',
  openQuestions: 'How should client access be secured?',
  references: [
    {
      url: 'https://example.com/reference',
      relevance: 'Test reference only, not naming research.',
    },
  ],
  namingCheck: { notes: 'Fixture name is unchecked; no availability claim.' },
};
