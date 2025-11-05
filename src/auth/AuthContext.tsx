import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo, useRef } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase/firebase';
import { UserProfile, SignUpData, SignInData } from '../types/user.types';
import { getUserProfile, createUserProfile, updateLastSeen } from '../api/userApi';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signUp: (data: SignUpData) => Promise<void>;
  signIn: (data: SignInData) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Ref для отслеживания последнего обновления lastSeen
  const lastSeenUpdateRef = useRef<number>(0);

  // Подписка на изменения аутентификации
  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      // Отписываемся от предыдущей подписки на профиль
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = undefined;
      }

      if (user) {
        // Подписываемся на изменения профиля в реальном времени
        const userDocRef = doc(db, 'users', user.uid);

        unsubscribeProfile = onSnapshot(
          userDocRef,
          (snapshot) => {
            if (snapshot.exists()) {
              const profileData = snapshot.data() as UserProfile;
              setUserProfile((prev) => {
                // Оптимизация: проверяем, действительно ли данные изменились
                const newProfile = {
                  ...profileData,
                  id: snapshot.id,
                };

                // Сравниваем ключевые поля, игнорируя lastSeen для избежания циклов
                if (
                  prev &&
                  prev.role === newProfile.role &&
                  prev.companyId === newProfile.companyId &&
                  prev.status === newProfile.status &&
                  prev.displayName === newProfile.displayName &&
                  prev.email === newProfile.email
                ) {
                  // Обновляем только если есть реальные изменения (не lastSeen)
                  return prev;
                }

                return newProfile;
              });
            } else {
              console.log('❌ User profile not found');
              setUserProfile(null);
            }
            setLoading(false);
          },
          (error) => {
            console.error('Error loading user profile:', error);
            setUserProfile(null);
            setLoading(false);
          }
        );

        // Обновляем время последней активности (lastSeen) ТОЛЬКО РАЗ при входе
        // Используем throttling - не чаще 1 раза в 5 минут
        const now = Date.now();
        const FIVE_MINUTES = 5 * 60 * 1000;

        if (now - lastSeenUpdateRef.current > FIVE_MINUTES) {
          lastSeenUpdateRef.current = now;
          updateLastSeen(user.uid).catch((error) => {
            console.error('Failed to update lastSeen:', error);
          });
        }
      } else {
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  /**
   * Регистрация нового пользователя с Email/Password
   */
  const signUp = async (data: SignUpData) => {
    try {
      // 1. Создаем пользователя в Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        data.email,
        data.password
      );

      // 2. Обновляем displayName в Auth
      await updateProfile(userCredential.user, {
        displayName: data.displayName,
      });

      // 3. Создаем профиль в Firestore
      await createUserProfile(userCredential.user.uid, {
        email: data.email,
        displayName: data.displayName,
        signupMethod: 'email',
      });

      console.log('✅ User signed up successfully');
    } catch (error: any) {
      console.error('❌ Error signing up:', error);
      throw new Error(getAuthErrorMessage(error.code));
    }
  };

  /**
   * Вход с Email/Password
   */
  const signIn = async (data: SignInData) => {
    try {
      await signInWithEmailAndPassword(auth, data.email, data.password);
      console.log('✅ User signed in successfully');
    } catch (error: any) {
      console.error('❌ Error signing in:', error);
      throw new Error(getAuthErrorMessage(error.code));
    }
  };

  /**
   * Вход через Google
   */
  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);

      // Проверяем, существует ли профиль пользователя
      const existingProfile = await getUserProfile(result.user.uid);

      // Если это новый пользователь, создаем профиль
      if (!existingProfile) {
        await createUserProfile(result.user.uid, {
          email: result.user.email || '',
          displayName: result.user.displayName || 'User',
          photoURL: result.user.photoURL || undefined,
          signupMethod: 'google',
        });
      }

      console.log('✅ User signed in with Google');
    } catch (error: any) {
      console.error('❌ Error signing in with Google:', error);
      throw new Error(getAuthErrorMessage(error.code));
    }
  };

  /**
   * Выход из системы
   */
  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      console.log('✅ User signed out');
    } catch (error: any) {
      console.error('❌ Error signing out:', error);
      throw new Error('Не удалось выйти из системы');
    }
  };

  /**
   * Восстановление пароля
   */
  const resetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      console.log('✅ Password reset email sent');
    } catch (error: any) {
      console.error('❌ Error sending password reset email:', error);
      throw new Error(getAuthErrorMessage(error.code));
    }
  };

  // Мемоизируем value для избежания лишних re-renders
  const value: AuthContextType = useMemo(
    () => ({
      currentUser,
      userProfile,
      loading,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      resetPassword,
    }),
    [currentUser, userProfile, loading]
  );

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

/**
 * Преобразует коды ошибок Firebase в понятные сообщения
 */
function getAuthErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'auth/email-already-in-use':
      return 'Этот email уже используется';
    case 'auth/invalid-email':
      return 'Некорректный email';
    case 'auth/operation-not-allowed':
      return 'Операция не разрешена';
    case 'auth/weak-password':
      return 'Слишком простой пароль (минимум 6 символов)';
    case 'auth/user-disabled':
      return 'Аккаунт отключен';
    case 'auth/user-not-found':
      return 'Пользователь не найден';
    case 'auth/wrong-password':
      return 'Неверный пароль';
    case 'auth/invalid-credential':
      return 'Неверный email или пароль';
    case 'auth/too-many-requests':
      return 'Слишком много попыток. Попробуйте позже';
    case 'auth/popup-closed-by-user':
      return 'Окно входа было закрыто';
    case 'auth/cancelled-popup-request':
      return 'Вход отменен';
    default:
      return 'Произошла ошибка. Попробуйте еще раз';
  }
}
