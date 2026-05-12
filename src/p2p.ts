let globalPeer: any = null;
let initPromise: Promise<void> | null = null;
const conns = new Map<string, any>();

const initPeer = async () => {
    if (initPromise) return initPromise;
    initPromise = new Promise((resolve) => {
        import('peerjs').then((module) => {
            const Peer = module.Peer || module.default;
            globalPeer = new Peer();
            globalPeer.on('open', () => {
                resolve();
            });
            globalPeer.on('error', () => {
                resolve();
            });
        }).catch(() => resolve());
    });
    return initPromise;
};

export const sendP2P = async (targetId: string, payload: any) => {
    if (!globalPeer) {
        await initPeer();
    }
    if (globalPeer && !globalPeer.destroyed) {
        let conn = conns.get(targetId);
        
        if (conn && conn.open) {
            conn.send(payload);
        } else if (conn && !conn.open) {
            // It's still connecting, wait for it
            const queueMsg = () => {
                if (conn.open) {
                    conn.send(payload);
                    conn.off('open', queueMsg);
                }
            };
            conn.on('open', queueMsg);
        } else {
            conn = globalPeer.connect(targetId, { reliable: true });
            conns.set(targetId, conn);
            conn.on('open', () => {
                conn.send(payload);
            });
            conn.on('close', () => {
                conns.delete(targetId);
            });
            conn.on('error', () => {
                conns.delete(targetId);
            });
        }
    }
};
