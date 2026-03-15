import type { IRNode, TranspileResult, SourceMapEntry } from './types.js';
import type { ResolvedKernConfig } from './config.js';
import { expandStyles } from './styles-react.js';
import { countTokens, serializeIR } from './utils.js';

const NODE_TO_COMPONENT: Record<string, string> = {
  screen: 'View',
  row: 'View',
  col: 'View',
  card: 'View',
  scroll: 'ScrollView',
  text: 'Text',
  image: 'Image',
  progress: 'View',
  divider: 'View',
  button: 'TouchableOpacity',
  input: 'TextInput',
  modal: 'Modal',
  list: 'View',
  item: 'View',
  tabs: 'View',
  tab: 'TouchableOpacity',
  header: 'View',
};

function styleToString(styles: Record<string, string | number>, indent: string): string {
  const entries = Object.entries(styles);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v]) => {
    const val = typeof v === 'number' ? String(v) : `'${v}'`;
    return `${indent}  ${k}: ${val},`;
  });
  return `{\n${lines.join('\n')}\n${indent}}`;
}

export function transpile(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const styleEntries: Record<string, Record<string, string | number>> = {};
  let styleIdx = 0;
  const lines: string[] = [];
  const imports = new Set<string>();

  // Collect theme definitions
  const themes: Record<string, Record<string, string>> = {};
  function collectThemes(node: IRNode): void {
    if (node.type === 'theme' && node.props) {
      const name = Object.values(node.props).find(v => typeof v === 'string') as string | undefined;
      const themeName = (node.props as Record<string, unknown>)['name'] as string | undefined;
      // theme nodes: type=theme, first prop value or the styles
      if (node.props.styles) {
        const key = themeName || name || `theme_${styleIdx++}`;
        themes[key] = node.props.styles as Record<string, string>;
      }
    }
    if (node.children) node.children.forEach(collectThemes);
  }
  collectThemes(root);

  // For theme nodes like "theme bar {h:8,br:4}", the type name follows "theme"
  // Re-collect from raw structure
  function collectThemeNodes(node: IRNode): void {
    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'theme') {
          // The name is the first string prop value or from props
          const props = child.props || {};
          // In our parser, "theme bar {h:8,br:4}" parses as type=theme with
          // remaining "bar" not matching a prop pattern. Let me handle this in a different way.
          // Actually looking at the parser, "bar" after "theme" would not be parsed as a prop.
          // Let me check: "theme bar {h:8,br:4}" - type="theme", then "bar" tries to match as prop (no =), fails.
          // So we need to handle theme name specially. For now, get it from the parser result.
          if (props.styles) {
            // Use first non-style, non-pseudoStyles key as name, or generate one
            const keys = Object.keys(props).filter(k => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs');
            const name = keys[0] || `theme_${styleIdx++}`;
            themes[name] = props.styles as Record<string, string>;
          }
        }
        collectThemeNodes(child);
      }
    }
  }
  collectThemeNodes(root);

  function getStyleName(nodeType: string): string {
    return `${nodeType}_${styleIdx++}`;
  }

  function renderNode(node: IRNode, indent: string): void {
    if (node.type === 'theme') return; // Don't render theme definitions

    const comp = NODE_TO_COMPONENT[node.type] || 'View';
    imports.add(comp);

    const irLine = node.loc?.line || 0;
    const outLine = lines.length + 1;
    sourceMap.push({ irLine, irCol: node.loc?.col || 1, outLine, outCol: 1 });

    const props = node.props || {};
    const attrs: string[] = [];

    // Compute merged styles: theme refs + inline
    let mergedStyles: Record<string, string | number> = {};

    // Apply theme refs first
    const themeRefs = (props.themeRefs as string[]) || [];
    for (const ref of themeRefs) {
      if (themes[ref]) {
        mergedStyles = { ...mergedStyles, ...expandStyles(themes[ref]) };
      }
    }

    // Apply inline styles on top
    if (props.styles) {
      mergedStyles = { ...mergedStyles, ...expandStyles(props.styles as Record<string, string>) };
    }

    // Add default flexDirection for row
    if (node.type === 'row' && !mergedStyles.flexDirection) {
      mergedStyles.flexDirection = 'row';
    }

    let styleName = '';
    if (Object.keys(mergedStyles).length > 0) {
      styleName = getStyleName(node.type);
      styleEntries[styleName] = mergedStyles;
      attrs.push(`style={styles.${styleName}}`);
    }

    // Handle pseudo-styles (simplified: just store as comment)
    const pseudoStyles = props.pseudoStyles as Record<string, Record<string, string>> | undefined;

    // Add meaningful props as JSX attributes
    for (const [k, v] of Object.entries(props)) {
      if (k === 'styles' || k === 'pseudoStyles' || k === 'themeRefs') continue;
      if (k === 'value' && node.type === 'text') continue; // handled as children
      if (k === 'text' && node.type === 'button') continue; // handled as children
      if (k === 'src' && node.type === 'image') {
        attrs.push(`source={require('./${v}')}`);
        continue;
      }
      attrs.push(`${k}="${v}"`);
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    const hasChildren = (node.children && node.children.length > 0) ||
      (node.type === 'text' && props.value) ||
      (node.type === 'button' && props.text) ||
      (node.type === 'progress');

    if (hasChildren) {
      lines.push(`${indent}<${comp}${attrStr}>`);

      // Text content
      if (node.type === 'text' && props.value) {
        lines.push(`${indent}  {${JSON.stringify(props.value)}}`);
      }

      // Button text
      if (node.type === 'button' && props.text) {
        imports.add('Text');
        lines.push(`${indent}  <Text style={styles.buttonText}>${props.text}</Text>`);
        if (!styleEntries.buttonText) {
          styleEntries.buttonText = { color: '#FFFFFF', textAlign: 'center', fontWeight: 'bold' };
        }
      }

      // Progress bar rendering
      if (node.type === 'progress') {
        imports.add('Text');
        const label = props.label || '';
        const current = props.current || 0;
        const target = props.target || 100;
        const unit = props.unit || '';
        lines.push(`${indent}  <Text>${label}: ${current}/${target} ${unit}</Text>`);
        const barStyle = getStyleName('progressBar');
        const fillStyle = getStyleName('progressFill');
        styleEntries[barStyle] = { height: 8, borderRadius: 4, backgroundColor: '#E0E0E0', overflow: 'hidden' };
        const color = (props.color as string) || '#007AFF';
        const pct = Number(current) / Number(target);
        styleEntries[fillStyle] = { height: 8, borderRadius: 4, backgroundColor: color, width: `${Math.round(pct * 100)}%` };
        lines.push(`${indent}  <View style={styles.${barStyle}}>`);
        lines.push(`${indent}    <View style={styles.${fillStyle}} />`);
        lines.push(`${indent}  </View>`);
      }

      // Child nodes
      if (node.children) {
        for (const child of node.children) {
          renderNode(child, indent + '  ');
        }
      }

      lines.push(`${indent}</${comp}>`);
    } else {
      lines.push(`${indent}<${comp}${attrStr} />`);
    }
  }

  // Render
  renderNode(root, '    ');

  // Build component name
  const name = (root.props?.name as string) || 'Component';

  // Build imports
  const importList = Array.from(imports).sort();
  const code: string[] = [];
  code.push(`import React from 'react';`);
  code.push(`import { ${importList.join(', ')}, StyleSheet } from 'react-native';`);
  code.push('');
  code.push(`const ${name}: React.FC = () => {`);
  code.push('  return (');
  code.push(...lines);
  code.push('  );');
  code.push('};');
  code.push('');

  // Build StyleSheet
  code.push('const styles = StyleSheet.create({');
  for (const [sname, sval] of Object.entries(styleEntries)) {
    code.push(`  ${sname}: ${styleToString(sval, '  ')},`);
  }
  code.push('});');
  code.push('');
  code.push(`export default ${name};`);

  const output = code.join('\n');

  // Serialize IR back for token counting
  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code: output,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
  };
}

