import {useCallback, useEffect, useState} from 'react';
import {ping, type PingResult} from './bridgeApi';

export type BridgeStatus = {state: 'checking'} | ({state: 'connected' | 'offline'} & PingResult);

const INTERVAL_MS = 15_000;

/** Checks the AI server now and then every 15 s (and when `url` changes). `recheck` checks at once. */
export function useBridgeStatus(url: string): {status: BridgeStatus; recheck(): void} {
    const [status, setStatus] = useState<BridgeStatus>({state: 'checking'});
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            const result = await ping(url);
            if (!cancelled) setStatus({state: result.ok ? 'connected' : 'offline', ...result});
        };
        void check();
        const timer = setInterval(() => void check(), INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [url, tick]);

    const recheck = useCallback(() => setTick((t) => t + 1), []);
    return {status, recheck};
}
