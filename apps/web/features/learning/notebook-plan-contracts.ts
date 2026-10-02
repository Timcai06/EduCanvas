export type NotebookPlanSourceDTO =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'chapter'; chapterId: string }
  | { kind: 'purpose'; purpose: string };
export type NotebookChapterLocatorDTO =
  { kind: 'whole' } | { kind: 'pages' | 'text'; start: number; end: number };
export interface NotebookPlanDTO {
  id: string;
  notebookId: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'archived';
  source: NotebookPlanSourceDTO;
  available: boolean;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface NotebookChapterDTO {
  id: string;
  notebookId: string;
  assetId: string;
  assetVersionId: string;
  title: string;
  locator: NotebookChapterLocatorDTO;
  origin: 'user_grouped';
  available: boolean;
}
export interface NotebookPlansDTO {
  plans: NotebookPlanDTO[];
  goal: {
    id: string;
    topic: string;
    desiredOutcome: string;
    status: string;
  } | null;
  canWrite: boolean;
}
export interface NotebookChaptersDTO {
  chapters: NotebookChapterDTO[];
  canWrite: boolean;
}
