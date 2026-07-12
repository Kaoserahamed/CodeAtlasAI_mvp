/**
 * File system scanner for discovering JS/TS files in a repository
 */

import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface ScannedFile {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  content: string;
}

/**
 * Recursively scan directory for JS/TS files
 */
export function scanDirectory(
  dirPath: string,
  baseDir?: string
): ScannedFile[] {
  const base = baseDir || dirPath;
  const files: ScannedFile[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Skip node_modules, .git, dist, build directories
      if (
        entry.isDirectory() &&
        ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(
          entry.name
        )
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        files.push(...scanDirectory(fullPath, base));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);

        // Check if file has supported extension
        if (config.supportedExtensions.includes(ext)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relativePath = path.relative(base, fullPath);

          files.push({
            path: fullPath,
            relativePath: relativePath.replace(/\\/g, '/'), // Normalize path separators
            name: entry.name,
            extension: ext,
            content,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }

  return files;
}

/**
 * Validate that a path exists and is accessible
 */
export function validatePath(targetPath: string): boolean {
  try {
    const stats = fs.statSync(targetPath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}
