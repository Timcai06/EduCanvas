import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { DesktopAuthStatus } from '../../shared/desktop-auth';
import {
  petUiStateForAuthTransition,
  type PetUiState,
} from './pet-visual-state';

interface DesktopAuthGateOptions {
  setState: Dispatch<SetStateAction<PetUiState>>;
  publishVisual(state: PetUiState): void;
  setMessage: Dispatch<SetStateAction<string>>;
}

export function useDesktopAuthGate({
  setState,
  publishVisual,
  setMessage,
}: DesktopAuthGateOptions): {
  authState: DesktopAuthStatus['state'] | 'checking';
  requireAuth(): Promise<boolean>;
  restartSignIn(): Promise<void>;
} {
  const [authState, setAuthState] = useState<
    DesktopAuthStatus['state'] | 'checking'
  >('checking');
  const authStateRef = useRef<DesktopAuthStatus['state'] | null>(null);

  useEffect(() => {
    const accept = (status: DesktopAuthStatus): void => {
      setAuthState(status.state);
      const previousAuthState = authStateRef.current;
      authStateRef.current = status.state;
      if (status.state === 'signed_in') {
        setState('ready');
        const visual = petUiStateForAuthTransition(
          previousAuthState,
          status.state,
        );
        if (visual) publishVisual(visual);
        setMessage('已经连接 EduCanvas，可以开始聊天。');
      } else if (status.state === 'error') {
        setState('auth-failed');
        publishVisual('auth-failed');
        setMessage(status.message);
      }
    };
    const unsubscribe = window.desktopAuth.onStatus(accept);
    void window.desktopAuth.getStatus().then(accept);
    return unsubscribe;
  }, []);

  const beginSignIn = async (force: boolean): Promise<boolean> => {
    const auth = await window.desktopAuth.getStatus();
    setAuthState(auth.state);
    if (!force && auth.state === 'signed_in') return true;
    setState('authorizing');
    publishVisual('authorizing');
    setMessage('请在浏览器完成登录与授权，然后回到这里继续。');
    if (force || auth.state !== 'authorizing') {
      const next = await window.desktopAuth.signIn();
      setAuthState(next.state);
    }
    return false;
  };

  return {
    authState,
    requireAuth: () => beginSignIn(false),
    restartSignIn: async () => void (await beginSignIn(true)),
  };
}
