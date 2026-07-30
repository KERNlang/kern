import {
  parseLegacyParameters,
} from './coverage-prerequisite-parameters.mjs';

function fail(message) {
  throw new TypeError(`coverage prerequisite rejection: ${message}`);
}

export function migrateLegacyFunctionForPrerequisite(sourceRoot) {
  if (
    sourceRoot === null ||
    typeof sourceRoot !== 'object' ||
    Array.isArray(sourceRoot) ||
    sourceRoot.type !== 'fn' ||
    !Array.isArray(sourceRoot.children)
  ) {
    fail('legacy function must be a function without direct parameter children');
  }
  const directParameters = sourceRoot.children.filter(({ type }) => type === 'param');
  if (directParameters.length > 0) {
    if (typeof sourceRoot.props?.params === 'string') {
      fail('legacy function must be a function without direct parameter children');
    }
    const firstNonParameter = sourceRoot.children
      .findIndex(({ type }) => type !== 'param');
    if (
      firstNonParameter === 0 ||
      sourceRoot.children.slice(firstNonParameter).some(({ type }) => type === 'param') ||
      directParameters.some((parameter) =>
        parameter === null ||
        typeof parameter !== 'object' ||
        !Array.isArray(parameter.children) ||
        parameter.children.length !== 0 ||
        parameter.props === null ||
        typeof parameter.props !== 'object' ||
        Array.isArray(parameter.props) ||
        Object.keys(parameter.props).sort().join(',') !== 'name,type' ||
        (parameter.__quotedProps?.length ?? 0) !== 0
      )
    ) {
      fail('direct parameters must be one exact canonical prefix');
    }
    const parameters = parseLegacyParameters(
      directParameters.map(({ props }) => `${props.name}:${props.type}`).join(','),
    );
    return { parameters, root: structuredClone(sourceRoot) };
  }
  const root = structuredClone(sourceRoot);
  const parameters = parseLegacyParameters(root.props?.params);
  delete root.props.params;
  if (Array.isArray(root.__quotedProps)) {
    root.__quotedProps = root.__quotedProps.filter((property) => property !== 'params');
    if (root.__quotedProps.length === 0) delete root.__quotedProps;
  }
  root.children = [
    ...parameters.map(({ name, type }) => ({ children: [], props: { name, type }, type: 'param' })),
    ...root.children,
  ];
  return { parameters, root };
}
