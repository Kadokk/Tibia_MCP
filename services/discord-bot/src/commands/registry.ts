export type RegisteredCommand = {
  name: string;
  description: string;
};

export const registeredCommands: RegisteredCommand[] = [
  { name: 'setup', description: 'Configure TibiaEdge for this server.' },
  { name: 'price', description: 'Show a real-time item price summary.' },
  { name: 'offers', description: 'Show recent item offers.' },
  { name: 'usage', description: 'Show your TibiaEdge tier and limits.' }
];

export function commandNames(): string[] {
  return registeredCommands.map((command) => command.name);
}
