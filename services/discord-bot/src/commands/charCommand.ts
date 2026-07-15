import type { TibiaDataClient } from '../sources/tibiaDataClient';
import { createTextResponse, type CommandResponse } from './types';

export async function executeCharCommand(input: {
  name: string;
  tibiaData: Pick<TibiaDataClient, 'getCharacter'>;
}): Promise<CommandResponse> {
  let character;
  try {
    character = await input.tibiaData.getCharacter(input.name);
  } catch {
    return createTextResponse('Could not reach the character service right now — please try again shortly.', true);
  }

  if (!character) {
    return createTextResponse(`No character named "${input.name}" was found.`, true);
  }

  const lines = [
    `**${character.name}** — level ${character.level} ${character.vocation}`,
    `World: ${character.world}`,
    `Residence: ${character.residence}`,
    `Last login: ${character.lastLogin ?? 'unknown'}`
  ];

  if (character.deaths.length > 0) {
    lines.push('Recent deaths:');
    for (const death of character.deaths.slice(0, 3)) {
      lines.push(`- ${death.time}: ${death.reason} (level ${death.level})`);
    }
  }

  return createTextResponse(lines.join('\n'));
}
