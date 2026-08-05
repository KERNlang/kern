import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';

export function withoutExcludedProperties(node) {
  const contract = STRUCTURAL_KIR_NODE_CATALOG.get(node.type);
  const props = Object.fromEntries(
    Object.entries(node.props ?? {}).filter(
      ([key]) => !contract?.properties[key]?.disposition?.startsWith('excluded-'),
    ),
  );
  const quotedProps = (node.__quotedProps ?? []).filter((name) => Object.hasOwn(props, name));
  const { __quotedProps: _quotedProps, ...rest } = node;
  return {
    ...rest,
    ...(quotedProps.length === 0 ? {} : { __quotedProps: quotedProps }),
    children: (node.children ?? []).map(withoutExcludedProperties),
    props,
  };
}
