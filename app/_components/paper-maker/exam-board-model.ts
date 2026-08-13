export type ExamBoardOption = { label: string; courseCount: number };
export function examBoardTabId(label: string) { return `exam-board-tab-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }
