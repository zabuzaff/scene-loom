import type { ApiError } from '../shared/schema';
export class RequestError extends Error {
  constructor(public detail: ApiError) {
    super(detail.message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new RequestError(result.error);
  return result.data;
}
export type AgentInfo = { root: string; cli: string; guide: string };
export function scenePrompt(
  info: AgentInfo,
  project: { id: string; title: string },
  scene: { id: string; title: string },
  action: 'continue' | 'edit',
) {
  return `Use Scene Loom's agent interface at ${info.guide}.\nCLI: ${info.cli}\nProject: ${project.title} (${project.id})\nScene: ${scene.title} (${scene.id})\n\nRead the current project and scene before making changes. ${action === 'continue' ? 'Continue from this scene. Create complete image-backed scenes and connect them to the flow.' : 'Revise this scene in place, keeping its stable ID. Import any replacement images before publishing.'} Preserve existing card positions and unrelated content and connections unless I request otherwise. Apply a validated atomic batch using the current content revision.\n\n${action === 'continue' ? 'My direction' : 'Requested changes'}: `;
}
export function starterPrompt(info: AgentInfo, projectId?: string) {
  return `Use Scene Loom's agent interface at ${info.guide}.\nCLI: ${info.cli}\n${projectId ? `Read project ${projectId}.` : 'Create a new game project with one canvas.'} Develop my idea into complete scenes with titles, descriptions, notes, and a main image for every scene. Import image files first, then publish the scenes and branching connections in a validated atomic batch.\n\nMy idea: `;
}
