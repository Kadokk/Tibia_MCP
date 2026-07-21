import { describe, expect, it } from 'vitest';
import { parseCatalogImportArgs } from './runCatalogImport';
import { CATALOG_IMPORT_ORDER } from '../scheduler/catalogImportScheduler';

describe('parseCatalogImportArgs', () => {
  it('imports every content type when no --type is given', () => {
    expect(parseCatalogImportArgs([])).toEqual({ types: [...CATALOG_IMPORT_ORDER], force: false });
  });

  it('imports only the requested type', () => {
    expect(parseCatalogImportArgs(['--type', 'spell'])).toEqual({ types: ['spell'], force: false });
  });

  it('accepts every valid content type', () => {
    for (const type of CATALOG_IMPORT_ORDER) {
      expect(parseCatalogImportArgs(['--type', type]).types).toEqual([type]);
    }
  });

  it('reads a page limit', () => {
    expect(parseCatalogImportArgs(['--type', 'spell', '--limit', '3'])).toEqual({ types: ['spell'], limit: 3, force: false });
  });

  it('accepts a limit of zero, which imports nothing', () => {
    expect(parseCatalogImportArgs(['--limit', '0']).limit).toBe(0);
  });

  it('leaves the limit unset when the flag is absent', () => {
    expect(parseCatalogImportArgs(['--type', 'npc']).limit).toBeUndefined();
  });

  // A typo must not silently import the whole corpus.
  it('rejects an unknown content type, naming the valid ones', () => {
    expect(() => parseCatalogImportArgs(['--type', 'monster'])).toThrow(/monster/);
    expect(() => parseCatalogImportArgs(['--type', 'monster'])).toThrow(/creature/);
  });

  it('rejects --type with no value', () => {
    expect(() => parseCatalogImportArgs(['--type'])).toThrow(/--type/);
  });

  // Number('abc') is NaN and slice(0, NaN) is empty, so an unchecked limit would
  // quietly import nothing and report success.
  it('rejects a non-numeric or negative limit', () => {
    expect(() => parseCatalogImportArgs(['--limit', 'abc'])).toThrow(/--limit/);
    expect(() => parseCatalogImportArgs(['--limit', '-1'])).toThrow(/--limit/);
    expect(() => parseCatalogImportArgs(['--limit'])).toThrow(/--limit/);
  });

  it('ignores argv entries before the flags, as node passes them', () => {
    expect(parseCatalogImportArgs(['node', 'runCatalogImport.ts', '--type', 'hunt']).types).toEqual(['hunt']);
  });
});

describe('parseCatalogImportArgs — --force', () => {
  it('is off unless asked for', () => {
    expect(parseCatalogImportArgs(['--type', 'spell']).force).toBe(false);
  });

  it('is a bare flag needing no value', () => {
    expect(parseCatalogImportArgs(['--type', 'spell', '--force'])).toEqual({
      types: ['spell'], force: true
    });
  });

  it('combines with a limit', () => {
    expect(parseCatalogImportArgs(['--force', '--limit', '5'])).toMatchObject({ force: true, limit: 5 });
  });
});
