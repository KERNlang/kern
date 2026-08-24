import { sha256 } from './canonical.js';
import type { CanonicalValue, ModuleKirModuleView, StructuralKirNodeView } from './model.js';

/** Bottom-up content identities. SHA-256 is used for stable equality, not secrecy or authentication. */
export class KirFactDigests {
  readonly #values = new WeakMap<object, string>();
  readonly #nodes = new WeakMap<object, string>();

  value(value: CanonicalValue): string {
    const cached = this.#values.get(value);
    if (cached) return cached;
    let identity: unknown;
    switch (value.tag) {
      case 'list':
        identity = {
          tag: value.tag,
          values: value.value.map((child) => this.value(child)),
        };
        break;
      case 'record':
        identity = {
          tag: value.tag,
          values: value.value.map((entry) => ({
            key: entry.key,
            value: this.value(entry.value),
          })),
        };
        break;
      case 'map':
        identity = {
          tag: value.tag,
          values: value.value.map((entry) => ({
            key: this.value(entry.key),
            value: this.value(entry.value),
          })),
        };
        break;
      case 'error':
        identity = {
          tag: value.tag,
          code: value.value.code,
          message: value.value.message,
          details: value.value.details ? this.value(value.value.details) : null,
        };
        break;
      default:
        identity = value;
    }
    const digest = sha256(identity);
    this.#values.set(value, digest);
    return digest;
  }

  node(node: StructuralKirNodeView): string {
    const cached = this.#nodes.get(node);
    if (cached) return cached;
    const digest = sha256({
      kind: node.kind,
      properties: node.properties.map((entry) => ({
        key: entry.key,
        value: this.value(entry.value),
      })),
      children: node.children.map((child) => this.node(child)),
    });
    this.#nodes.set(node, digest);
    return digest;
  }

  module(module: ModuleKirModuleView): string {
    return sha256({
      id: module.id,
      exports: module.exports,
      imports: module.imports,
      roots: module.roots.map((root) => this.node(root)),
    });
  }

  publicSignature(root: StructuralKirNodeView | undefined, exported: ModuleKirModuleView['exports'][number]): string {
    if (!root) return sha256(exported);
    return sha256({
      properties: root.properties.map((entry) => ({
        key: entry.key,
        value: this.value(entry.value),
      })),
      params: root.children.filter((child) => child.kind === 'param').map((child) => this.node(child)),
    });
  }

  publicContent(root: StructuralKirNodeView, source: string | null): string {
    return sha256({
      kind: root.kind,
      source,
      properties: root.properties
        .filter((entry) => entry.key !== 'name')
        .map((entry) => ({ key: entry.key, value: this.value(entry.value) })),
      children: root.children.map((child) => this.node(child)),
    });
  }
}
