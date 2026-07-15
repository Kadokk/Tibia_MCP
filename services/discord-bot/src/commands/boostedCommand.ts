import type { TibiaDataClient } from '../sources/tibiaDataClient';
import { createTextResponse, type CommandResponse } from './types';

export async function executeBoostedCommand(input: {
  tibiaData: Pick<TibiaDataClient, 'getBoosted'>;
}): Promise<CommandResponse> {
  try {
    const boosted = await input.tibiaData.getBoosted();
    return createTextResponse(
      `**Today's boosted**\nCreature: ${boosted.creatureName}\nBoss: ${boosted.bossName}`
    );
  } catch {
    return createTextResponse("Could not fetch today's boosted right now — please try again shortly.", true);
  }
}
