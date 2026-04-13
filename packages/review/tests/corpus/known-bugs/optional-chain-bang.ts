// BUG: optional chain followed by non-null assertion — contradictory
interface Config {
  db?: {
    host: string;
    port: number;
  };
}

export function getDbHost(config: Config): string {
  return config.db?.host!; // if db is undefined, this crashes
}
