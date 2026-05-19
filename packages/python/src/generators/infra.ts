/**
 * Infrastructure generators — Python generation for KERN's infra nodes:
 * job, storage, email
 */

import type { IRNode } from '@kernlang/core';
import { handlerCode } from '@kernlang/core';
import { kids, p } from '../codegen-helpers.js';
import { mapTsTypeToPython, toSnakeCase } from '../type-map.js';

// ── Job (arq worker) ────────────────────────────────────────────────────

export function generatePythonJob(node: IRNode): string[] {
  const props = p(node);
  const name = toSnakeCase((props.name as string) || 'job');
  const _queue = (props.queue as string) || name;
  const code = handlerCode(node);
  const lines: string[] = [];
  lines.push(`# Run: arq main.WorkerSettings`);
  lines.push(`from arq import create_pool, func`);
  lines.push(`from arq.connections import RedisSettings`);
  lines.push('');
  lines.push(
    `async def ${name}(ctx${
      kids(node, 'field').length > 0
        ? ', ' +
          kids(node, 'field')
            .map((f) => `${toSnakeCase(p(f).name as string)}: ${mapTsTypeToPython((p(f).type as string) || 'Any')}`)
            .join(', ')
        : ''
    }):`,
  );
  if (code) {
    for (const line of code.split('\n')) lines.push(`    ${line}`);
  } else {
    lines.push(`    pass`);
  }
  lines.push('');
  lines.push('');
  lines.push(`class WorkerSettings:`);
  lines.push(`    functions = [func(${name}, name="${name}")]`);
  lines.push(`    redis_settings = RedisSettings()`);
  return lines;
}

// ── Storage (S3/local) ──────────────────────────────────────────────────

export function generatePythonStorage(node: IRNode): string[] {
  const props = p(node);
  const provider = (props.provider as string) || 's3';
  const bucket = (props.bucket as string) || 'my-app-uploads';
  const lines: string[] = [];
  if (provider === 's3') {
    lines.push(`import aioboto3`);
    lines.push(`import os`);
    lines.push('');
    lines.push(`BUCKET = os.environ.get("S3_BUCKET", "${bucket}")`);
    lines.push(`REGION = os.environ.get("AWS_REGION", "us-east-1")`);
    lines.push(`session = aioboto3.Session()`);
    lines.push('');
    lines.push(`async def upload_file(key: str, data: bytes, content_type: str) -> str:`);
    lines.push(`    async with session.client("s3", region_name=REGION) as s3:`);
    lines.push(`        await s3.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)`);
    lines.push(`    return key`);
    lines.push('');
    lines.push(`async def get_signed_url(key: str, expires_in: int = 3600) -> str:`);
    lines.push(`    async with session.client("s3", region_name=REGION) as s3:`);
    lines.push(
      `        return await s3.generate_presigned_url("get_object", Params={"Bucket": BUCKET, "Key": key}, ExpiresIn=expires_in)`,
    );
  } else {
    lines.push(`from pathlib import Path`);
    lines.push('');
    lines.push(`STORAGE_DIR = Path("./uploads")`);
    lines.push(`STORAGE_DIR.mkdir(parents=True, exist_ok=True)`);
    lines.push('');
    lines.push(`async def upload_file(key: str, data: bytes) -> str:`);
    lines.push(`    (STORAGE_DIR / key).write_bytes(data)`);
    lines.push(`    return key`);
    lines.push('');
    lines.push(`async def read_file(key: str) -> bytes:`);
    lines.push(`    return (STORAGE_DIR / key).read_bytes()`);
  }
  return lines;
}

// ── Email (SendGrid/SMTP) ───────────────────────────────────────────────

export function generatePythonEmail(node: IRNode): string[] {
  const props = p(node);
  const provider = (props.provider as string) || 'smtp';
  const from = (props.from as string) || 'noreply@example.com';
  const lines: string[] = [];
  if (provider === 'sendgrid') {
    lines.push(`import httpx`);
    lines.push(`import os`);
    lines.push('');
    lines.push(`SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")`);
    lines.push(`DEFAULT_FROM = "${from}"`);
    lines.push('');
    lines.push(`async def send_email(to: str, subject: str, html: str, sender: str = DEFAULT_FROM) -> None:`);
    lines.push(`    async with httpx.AsyncClient() as client:`);
    lines.push(
      `        await client.post("https://api.sendgrid.com/v3/mail/send", headers={"Authorization": f"Bearer {SENDGRID_API_KEY}"}, json={"personalizations": [{"to": [{"email": to}]}], "from": {"email": sender}, "subject": subject, "content": [{"type": "text/html", "value": html}]})`,
    );
  } else {
    lines.push(`import aiosmtplib`);
    lines.push(`from email.message import EmailMessage`);
    lines.push(`import os`);
    lines.push('');
    lines.push(`async def send_email(to: str, subject: str, html: str, sender: str = "${from}") -> None:`);
    lines.push(`    msg = EmailMessage()`);
    lines.push(`    msg["From"] = sender`);
    lines.push(`    msg["To"] = to`);
    lines.push(`    msg["Subject"] = subject`);
    lines.push(`    msg.set_content(html, subtype="html")`);
    lines.push(
      `    await aiosmtplib.send(msg, hostname=os.environ.get("SMTP_HOST", "localhost"), port=int(os.environ.get("SMTP_PORT", "587")))`,
    );
  }
  return lines;
}
