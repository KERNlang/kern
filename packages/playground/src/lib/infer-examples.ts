import type { PlaygroundTarget } from './targets';

/** Per-target example code for infer mode — shows idiomatic code in each framework */
export const INFER_EXAMPLES: Record<PlaygroundTarget, string> = {
  tailwind: `import React from 'react';

interface UserCardProps {
  name: string;
  email: string;
  avatar: string;
}

export function UserCard({ name, email, avatar }: UserCardProps) {
  return (
    <div style={{ padding: 16, borderRadius: 12, background: '#fff' }}>
      <img src={avatar} alt={name} style={{ width: 48, height: 48, borderRadius: 24 }} />
      <h2 style={{ fontSize: 18, fontWeight: 'bold' }}>{name}</h2>
      <p style={{ fontSize: 14, color: '#666' }}>{email}</p>
      <button style={{ padding: '8px 16px', borderRadius: 8, background: '#007AFF', color: '#fff' }}>
        Follow
      </button>
    </div>
  );
}`,

  nextjs: `import { useRouter } from 'next/router';

interface ProjectProps {
  id: string;
  title: string;
  status: string;
  image: string;
}

export default function ProjectPage({ id, title, status, image }: ProjectProps) {
  const router = useRouter();

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <img src={image} alt={title} style={{ width: '100%', borderRadius: 12 }} />
      <h1 style={{ fontSize: 24, fontWeight: 'bold', marginTop: 16 }}>{title}</h1>
      <p style={{ fontSize: 20, color: '#007AFF' }}>{status}</p>
      <button
        onClick={() => router.push('/projects')}
        style={{ padding: '12px 24px', borderRadius: 8, background: '#000', color: '#fff', width: '100%' }}
      >
        View Details
      </button>
    </div>
  );
}`,

  web: `import React, { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ textAlign: 'center', padding: 32 }}>
      <h1 style={{ fontSize: 48, fontWeight: 'bold' }}>{count}</h1>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button onClick={() => setCount(c => c - 1)} style={{ padding: '8px 24px', borderRadius: 8 }}>
          -
        </button>
        <button onClick={() => setCount(c => c + 1)} style={{ padding: '8px 24px', borderRadius: 8, background: '#007AFF', color: '#fff' }}>
          +
        </button>
      </div>
    </div>
  );
}`,

  native: `import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';

interface ProfileProps {
  name: string;
  bio: string;
  avatar: string;
}

export function Profile({ name, bio, avatar }: ProfileProps) {
  return (
    <View style={styles.container}>
      <Image source={{ uri: avatar }} style={styles.avatar} />
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.bio}>{bio}</Text>
      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>Edit Profile</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  name: { fontSize: 20, fontWeight: 'bold', marginTop: 12 },
  bio: { fontSize: 14, color: '#666', marginTop: 4 },
  button: { marginTop: 16, padding: 12, borderRadius: 8, backgroundColor: '#007AFF' },
  buttonText: { color: '#fff', fontWeight: '600' },
});`,

  express: `import express from 'express';
import { z } from 'zod';

const app = express();
app.use(express.json());

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
});

app.get('/api/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json({ users });
});

app.post('/api/users', async (req, res) => {
  const parsed = UserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  const user = await db.insert('users', parsed.data);
  res.status(201).json({ user });
});

app.listen(3000);`,

  fastapi: `from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class User(BaseModel):
    name: str
    email: str
    role: str = "user"

users_db: list[User] = []

@app.get("/api/users")
async def list_users():
    return {"users": users_db}

@app.post("/api/users", status_code=201)
async def create_user(user: User):
    if any(u.email == user.email for u in users_db):
        raise HTTPException(status_code=409, detail="Email exists")
    users_db.append(user)
    return {"user": user}`,

  terminal: `import { program } from 'commander';
import chalk from 'chalk';

interface Task {
  id: number;
  title: string;
  done: boolean;
}

const tasks: Task[] = [];
let nextId = 1;

program
  .name('todo')
  .description('Simple task manager');

program
  .command('add <title>')
  .description('Add a new task')
  .action((title: string) => {
    tasks.push({ id: nextId++, title, done: false });
    console.log(chalk.green('Added:'), title);
  });

program
  .command('list')
  .description('Show all tasks')
  .action(() => {
    for (const t of tasks) {
      const status = t.done ? chalk.green('✓') : chalk.red('○');
      console.log(\`  \${status} [\${t.id}] \${t.title}\`);
    }
  });

program.parse();`,

  ink: `import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';

function App() {
  const [selected, setSelected] = useState(0);
  const items = ['Build project', 'Run tests', 'Deploy', 'Exit'];

  useInput((input, key) => {
    if (key.upArrow) setSelected(s => Math.max(0, s - 1));
    if (key.downArrow) setSelected(s => Math.min(items.length - 1, s + 1));
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Task Runner</Text>
      {items.map((item, i) => (
        <Text key={item} color={i === selected ? 'green' : 'white'}>
          {i === selected ? '▸ ' : '  '}{item}
        </Text>
      ))}
    </Box>
  );
}

render(<App />);`,

  vue: `<template>
  <div class="card">
    <img :src="avatar" :alt="name" class="avatar" />
    <h2>{{ name }}</h2>
    <p>{{ email }}</p>
    <button @click="follow">Follow</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  email: string;
  avatar: string;
}>();

function follow() {
  console.log('Followed!');
}
</script>

<style scoped>
.card { padding: 16px; border-radius: 12px; background: #fff; }
.avatar { width: 48px; height: 48px; border-radius: 24px; }
</style>`,

  nuxt: `<template>
  <div class="page">
    <h1>{{ project.title }}</h1>
    <img :src="project.image" :alt="project.title" />
    <p class="status">{{ project.status }}</p>
    <button @click="viewDetails">View Details</button>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const { data: project } = await useFetch(\`/api/projects/\${route.params.id}\`);

function viewDetails() {
  navigateTo('/projects');
}
</script>`,
};
