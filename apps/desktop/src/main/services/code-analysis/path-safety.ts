import { relative, resolve, sep } from 'path';

export function resolveInsideRoot(rootPath: string, requestedPath = '.'): string {
  const root = resolve(rootPath);
  const target = resolve(root, requestedPath);
  const rel = relative(root, target);

  if (rel === '') return target;
  if (rel.startsWith('..') || rel === '..' || rel.includes(`..${sep}`)) {
    throw new Error(`Path is outside the selected project root: ${requestedPath}`);
  }

  return target;
}

export function toProjectRelativePath(rootPath: string, absolutePath: string): string {
  return relative(resolve(rootPath), resolve(absolutePath)).replace(/\\/g, '/');
}
