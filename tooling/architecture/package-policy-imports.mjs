import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
]);
const IGNORED_DIRECTORIES = new Set([
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const PROVIDER_PACKAGE =
  /^(?:ai(?:\/.*)?|@ai-sdk\/|openai(?:\/.*)?$|anthropic(?:\/.*)?$)/;

function dependencySections(manifest) {
  return [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ].flatMap((section) =>
    Object.keys(manifest[section] ?? {}).map((target) => ({ section, target })),
  );
}

function allowlistKey(entry) {
  return `${entry.consumer}\0${entry.target}\0${entry.specifier}`;
}

function workspaceTarget(specifier) {
  if (!specifier.startsWith('@educanvas/')) return undefined;
  return specifier.split('/').slice(0, 2).join('/');
}

export function manifestDependencyViolations(policy, workspaces) {
  const violations = [];
  const packages = new Map(policy.packages.map((entry) => [entry.name, entry]));
  const dependencyAllowlist = new Set(
    policy.allowlist.dependencies.map((entry) => allowlistKey(entry)),
  );
  for (const workspace of workspaces) {
    const consumer = packages.get(workspace.name);
    if (!consumer) continue;
    for (const { section, target: dependency } of dependencySections(
      workspace.manifest,
    )) {
      const targetName = workspaceTarget(dependency);
      if (targetName) {
        const target = packages.get(targetName);
        if (!target) {
          violations.push(
            `${workspace.name} -> ${targetName}: unknown workspace dependency in ${workspace.path}/package.json (${section}); register the target package`,
          );
          continue;
        }
        const key = allowlistKey({
          consumer: workspace.name,
          target: targetName,
          specifier: dependency,
        });
        if (
          !consumer.allowedDependencyKinds.includes(target.kind) &&
          !dependencyAllowlist.has(key)
        )
          violations.push(
            `${workspace.name} -> ${targetName}: ${consumer.kind} packages cannot depend on ${target.kind} packages (${workspace.path}/package.json ${section}); move composition to an app or depend on a permitted port`,
          );
        if (consumer.forbiddenDependencies.includes(targetName))
          violations.push(
            `${workspace.name} -> ${targetName}: dependency is explicitly forbidden (${workspace.path}/package.json ${section}); remove the dependency`,
          );
      }
      if (
        PROVIDER_PACKAGE.test(dependency) &&
        workspace.name !== '@educanvas/model-gateway'
      )
        violations.push(
          `${workspace.name} -> ${dependency}: Provider SDK dependencies belong only in @educanvas/model-gateway (${workspace.path}/package.json ${section}); use the model gateway contract`,
        );
    }
  }
  return violations;
}

function collectSourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED_DIRECTORIES.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))
      ? [path]
      : [];
  });
}

export function parseModuleSpecifiers(source, fileName = 'fixture.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = [];
  const record = (node) => {
    if (ts.isStringLiteralLike(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      imports.push({ specifier: node.text, line: position.line + 1 });
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) record(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    )
      record(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function consumerForPath(path, workspaces) {
  const workspace = workspaces.find(
    (item) => path === item.path || path.startsWith(`${item.path}/`),
  );
  if (workspace) return workspace.name;
  if (path.startsWith('tooling/evals/')) return 'tooling/evals';
  return path.split('/').slice(0, 2).join('/');
}

export function sourceImportViolations(policy, workspaces, sources) {
  const violations = [];
  const usedAllowlist = new Set();
  const allowlist = new Map(
    policy.allowlist.dependencies.map((entry) => [allowlistKey(entry), entry]),
  );
  for (const source of sources) {
    const consumer = consumerForPath(source.path, workspaces);
    for (const imported of source.imports) {
      const target = workspaceTarget(imported.specifier);
      const location = `${source.path}:${imported.line}`;
      if (
        PROVIDER_PACKAGE.test(imported.specifier) &&
        consumer !== '@educanvas/model-gateway'
      )
        violations.push(
          `${consumer} -> ${imported.specifier}: Provider SDK import at ${location}; import a @educanvas/model-gateway contract instead`,
        );
      if (
        imported.specifier === '@educanvas/db/internal' &&
        consumer !== '@educanvas/db'
      ) {
        const key = allowlistKey({
          consumer,
          target: '@educanvas/db',
          specifier: imported.specifier,
        });
        if (allowlist.has(key)) usedAllowlist.add(key);
        else
          violations.push(
            `${consumer} -> @educanvas/db/internal: DB internal import at ${location} is not allowlisted; use a public repository port or add exact, expiring debt metadata`,
          );
      }
      if (target && !policy.packages.some((entry) => entry.name === target))
        violations.push(
          `${consumer} -> ${target}: unknown package import at ${location}; register the workspace or correct the specifier`,
        );
    }
  }
  for (const entry of policy.allowlist.dependencies) {
    const key = allowlistKey(entry);
    if (entry.specifier === '@educanvas/db/internal' && !usedAllowlist.has(key))
      violations.push(
        `${entry.consumer} -> ${entry.specifier}: allowlist entry is unused; remove stale debt metadata`,
      );
  }
  return violations;
}

export function repositorySources(root, workspaces) {
  const roots = [
    ...workspaces.map((workspace) => resolve(root, workspace.path)),
    resolve(root, 'tooling/evals'),
    resolve(root, 'tests'),
  ];
  return roots.flatMap((directory) =>
    collectSourceFiles(directory).map((file) => ({
      path: relative(root, file),
      imports: parseModuleSpecifiers(readFileSync(file, 'utf8'), file),
    })),
  );
}
