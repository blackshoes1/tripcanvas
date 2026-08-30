'use client';
import { useSyncExternalStore } from 'react';

import { type AppCfg, getCfgServerSnapshot, getCfgSnapshot, saveCfg, subscribeCfg } from '../services/cfgStore';

export function useCfg(): { cfg: AppCfg; setCfg: (patch: Partial<AppCfg>) => boolean } {
  const cfg = useSyncExternalStore(subscribeCfg, getCfgSnapshot, getCfgServerSnapshot);
  return { cfg, setCfg: saveCfg };
}
