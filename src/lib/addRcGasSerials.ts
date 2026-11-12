import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const FUNCTIONS_REGION = 'us-central1';

export type AddRcGasSerialsResult = {
  added: string[];
  alreadyPresent: string[];
  invalid: string[];
  conflicts: string[];
  ovQuota: number | null;
  ovQuotaDelta: number;
};

export async function addRcGasSerials(input: {
  serials: string;
  rcCode?: string;
  companyName?: string;
}): Promise<AddRcGasSerialsResult> {
  const fn = httpsCallable<
    { serials: string; rcCode?: string; companyName?: string },
    AddRcGasSerialsResult
  >(getFunctions(app, FUNCTIONS_REGION), 'addRcGasSerials');
  const res = await fn({
    serials: input.serials,
    ...(input.rcCode ? { rcCode: input.rcCode } : {}),
    ...(input.companyName ? { companyName: input.companyName } : {}),
  });
  return res.data;
}
