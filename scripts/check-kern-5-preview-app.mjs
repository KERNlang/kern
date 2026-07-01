#!/usr/bin/env node
import { createPreviewAppServer } from '../examples/kern-5-preview-app/server.mjs';

class DemoSmokeFailure extends Error {}

const server = createPreviewAppServer();

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  return { response, text: await response.text() };
}

async function fetchJson(url) {
  const { response, json } = await fetchJsonResponse(url);
  if (!response.ok) throw new DemoSmokeFailure(`route returned ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

async function fetchJsonResponse(url) {
  const { response, text } = await fetchText(url);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DemoSmokeFailure(`expected JSON response from ${url}, got ${JSON.stringify(text.slice(0, 120))}`);
  }
  return { response, json };
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address !== 'object') throw new DemoSmokeFailure('preview app did not bind a TCP port');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const { response: uiResponse, text: html } = await fetchText(`${baseUrl}/`);
  if (!uiResponse.ok) throw new DemoSmokeFailure(`UI route returned ${uiResponse.status}`);
  if (!html.includes('data-kern-ui="native-runner-preview"')) {
    throw new DemoSmokeFailure('UI route did not render the KERN-authored browser marker');
  }
  if (!html.includes('/api/answer?question=')) {
    throw new DemoSmokeFailure('UI route did not include the answer API wiring');
  }

  const answer = await fetchJson(`${baseUrl}/api/answer?question=refund%20policy%20receipt`);
  if (answer.status !== 'grounded') throw new DemoSmokeFailure(`answer route returned status ${answer.status}`);
  if (answer.grounded !== true) throw new DemoSmokeFailure(`answer route returned grounded ${answer.grounded}`);
  if (answer.chunkCount !== 1) throw new DemoSmokeFailure(`answer route returned chunkCount ${answer.chunkCount}`);
  if (answer.source !== 'corpus/refunds.md') {
    throw new DemoSmokeFailure(`answer route returned source ${JSON.stringify(answer.source)}`);
  }
  if (!Array.isArray(answer.citations) || answer.citations[0]?.source !== 'corpus/refunds.md') {
    throw new DemoSmokeFailure(`answer route returned citations ${JSON.stringify(answer.citations)}`);
  }
  if (answer.diagnostics?.chunkCount !== 1 || answer.diagnostics?.grounded === false) {
    throw new DemoSmokeFailure(`answer route returned diagnostics ${JSON.stringify(answer.diagnostics)}`);
  }
  if (!String(answer.answer).includes('Refunds are available within thirty days')) {
    throw new DemoSmokeFailure(`answer route returned unexpected answer ${JSON.stringify(answer.answer)}`);
  }

  const secondAnswer = await fetchJson(`${baseUrl}/api/answer?question=money%20back%20refund%20policy`);
  if (secondAnswer.status !== 'grounded') {
    throw new DemoSmokeFailure(`second answer route returned status ${secondAnswer.status}`);
  }
  if (secondAnswer.source !== 'corpus/refunds.md') {
    throw new DemoSmokeFailure(`second answer route returned source ${JSON.stringify(secondAnswer.source)}`);
  }
  if (!String(secondAnswer.answer).includes('\nSupport should cite the refund policy')) {
    throw new DemoSmokeFailure(`second answer route returned unexpected answer ${JSON.stringify(secondAnswer.answer)}`);
  }

  const unsupported = await fetchJsonResponse(`${baseUrl}/api/answer?question=shipping%20tracking%20delivery`);
  if (unsupported.response.status !== 422) {
    throw new DemoSmokeFailure(`unsupported query returned ${unsupported.response.status}`);
  }
  if (unsupported.json.error !== 'no grounded answer for this question') {
    throw new DemoSmokeFailure(`unsupported query returned ${JSON.stringify(unsupported.json)}`);
  }
  if (unsupported.json.diagnostics?.grounded !== false) {
    throw new DemoSmokeFailure(`unsupported query returned diagnostics ${JSON.stringify(unsupported.json)}`);
  }

  const ungrounded = await fetchJsonResponse(
    `${baseUrl}/api/answer?question=refund%20policy%20receipt&failure=ungrounded`,
  );
  if (ungrounded.response.status !== 422) {
    throw new DemoSmokeFailure(`ungrounded answer returned ${ungrounded.response.status}`);
  }
  if (ungrounded.json.error !== 'no grounded answer for this question') {
    throw new DemoSmokeFailure(`ungrounded answer returned ${JSON.stringify(ungrounded.json)}`);
  }

  const missingLlm = await fetchJsonResponse(
    `${baseUrl}/api/answer?question=refund%20policy%20receipt&failure=missing-llm`,
  );
  if (missingLlm.response.status !== 503) {
    throw new DemoSmokeFailure(`missing LLM returned ${missingLlm.response.status}`);
  }
  if (missingLlm.json.error !== 'required host capability is unavailable') {
    throw new DemoSmokeFailure(`missing LLM returned ${JSON.stringify(missingLlm.json)}`);
  }
  if (missingLlm.json.diagnostics?.capability !== 'llm.complete') {
    throw new DemoSmokeFailure(`missing LLM returned diagnostics ${JSON.stringify(missingLlm.json)}`);
  }

  const unrelated = await fetchJsonResponse(`${baseUrl}/api/answer?question=banana%20unrelated`);
  if (unrelated.response.status !== 422) {
    throw new DemoSmokeFailure(`unrelated query returned ${unrelated.response.status}`);
  }

  const missing = await fetchJsonResponse(`${baseUrl}/api/answer?question=`);
  if (missing.response.status !== 400) {
    throw new DemoSmokeFailure(`missing query returned ${missing.response.status}`);
  }
  if (missing.json.error !== 'question is required') {
    throw new DemoSmokeFailure(`missing query returned ${JSON.stringify(missing.json)}`);
  }

  console.log('kern 5 preview app smoke passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
}
