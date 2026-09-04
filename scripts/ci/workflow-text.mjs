export function workflowJob(workflow, id) {
  const jobsIndex = workflow.indexOf('\njobs:\n');
  const scoped = jobsIndex < 0 ? workflow : workflow.slice(jobsIndex);
  const marker = `  ${id}:\n`;
  const start = scoped.indexOf(marker);
  if (start < 0) throw new Error(`workflow must define ${id}`);
  const bodyStart = start + marker.length;
  const next = scoped.slice(bodyStart).search(/\n  [a-z][\w-]*:\n/u);
  return next < 0 ? scoped.slice(start) : scoped.slice(start, bodyStart + next);
}
