/**
 * Repository Scanner
 * Recursively scans a directory and parses all JS/TS files
 */

import fs from 'fs';
import path from 'path';
import { ASTParser } from './astParser';
import { CodeGraph } from '../types';
import { config } from '../config';

export class RepositoryScanner {
  private parser: ASTParser;
  private supportedExtensions: Set<string>;

  constructor() {
    this.parser = new ASTParser();
    this.supportedExtensions = new Set(config.supportedExtensions);
  }

  /**
   * Scan a directory and extract code graph
   */
  scanDirectory(directoryPath: string): CodeGraph {
    const graph: CodeGraph = {
      files: [],
      functions: [],
      imports: [],
      calls: [],
    };

    const files = this.getAllFiles(directoryPath);
    console.log(`Found ${files.length} files to parse...`);

    for (const file of files) {
      try {
        console.log(`Parsing: ${file}`);
        const result = this.parser.parseFile(file);

        graph.files.push(result.file);
        graph.functions.push(...result.functions);
        graph.imports.push(...result.imports);
        graph.calls.push(...result.calls);
      } catch (error) {
        console.error(`Error parsing ${file}:`, error);
      }
    }

    console.log('\n=== Scan Summary ===');
    console.log(`Files: ${graph.files.length}`);
    console.log(`Functions: ${graph.functions.length}`);
    console.log(`Imports: ${graph.imports.length}`);
    console.log(`Calls: ${graph.calls.length}`);

    return graph;
  }

  /**
   * Recursively get all supported files in directory
   */
  private getAllFiles(dirPath: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        // Skip common directories to ignore
        if (this.shouldIgnoreDirectory(file)) {
          continue;
        }
        this.getAllFiles(filePath, fileList);
      } else if (stat.isFile()) {
        const ext = path.extname(file);
        if (this.supportedExtensions.has(ext)) {
          fileList.push(filePath);
        }
      }
    }

    return fileList;
  }

  /**
   * Check if directory should be ignored
   */
  private shouldIgnoreDirectory(dirName: string): boolean {
    const ignoreDirs = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      'out',
      '__pycache__',
      '.vscode',
      '.idea',
    ];
    return ignoreDirs.includes(dirName);
  }
}
