export interface ParsedDocument {
  title: string;
  chapters: Chapter[];
  rawText: string;
}

export interface Chapter {
  id: string;
  index: number;
  title: string;
  level: number;
  content: string;
}
