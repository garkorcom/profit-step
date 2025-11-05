import { getStorage, ref, uploadBytesResumable, UploadTaskSnapshot, deleteObject } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

/**
 * Загружает аватар пользователя в Firebase Storage
 *
 * @param file - Файл изображения для загрузки
 * @param onProgress - Callback для отслеживания прогресса (0-100)
 * @returns Promise с результатом загрузки
 */
export async function uploadAvatar(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  try {
    // 1. Проверка авторизации
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('Вы не авторизованы');
    }

    // 2. Валидация файла
    if (!file.type.startsWith('image/')) {
      throw new Error('Файл должен быть изображением');
    }

    // Ограничение размера: 5 MB
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new Error('Размер файла не должен превышать 5 MB');
    }

    console.log('📤 Uploading avatar for user:', currentUser.uid);
    console.log('📦 File size:', (file.size / 1024).toFixed(2), 'KB');

    // 3. Создание пути в Storage
    const storage = getStorage();
    const storageRef = ref(storage, `avatars/${currentUser.uid}/original`);

    // 4. Загрузка с отслеживанием прогресса
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedBy: currentUser.uid,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Обработка прогресса
    return new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot: UploadTaskSnapshot) => {
          // Прогресс загрузки
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log(`⏳ Upload progress: ${progress.toFixed(0)}%`);

          if (onProgress) {
            onProgress(Math.round(progress));
          }
        },
        (error) => {
          // Ошибка загрузки
          console.error('❌ Upload failed:', error);
          reject({
            success: false,
            message: 'Не удалось загрузить файл',
            error: error.message,
          });
        },
        () => {
          // Успешная загрузка
          console.log('✅ Upload complete!');
          console.log('⏳ Waiting for backend processing (sharp thumbnail creation)...');

          resolve({
            success: true,
            message: 'Аватар загружен! Обработка может занять несколько секунд.',
          });
        }
      );
    });
  } catch (error: any) {
    console.error('❌ Error uploading avatar:', error);
    return {
      success: false,
      message: 'Ошибка при загрузке аватара',
      error: error.message,
    };
  }
}

/**
 * Удаляет аватар пользователя
 */
export async function deleteAvatar(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      throw new Error('Вы не авторизованы');
    }

    const storage = getStorage();

    // Удаляем оба файла (если есть)
    const originalRef = ref(storage, `avatars/${currentUser.uid}/original`);
    const thumbnailRef = ref(storage, `avatars/${currentUser.uid}/thumbnail_256x256.jpg`);

    try {
      await deleteObject(originalRef);
    } catch (e) {
      console.log('Original not found, skipping');
    }

    try {
      await deleteObject(thumbnailRef);
    } catch (e) {
      console.log('Thumbnail not found, skipping');
    }

    return {
      success: true,
      message: 'Аватар удален',
    };
  } catch (error: any) {
    console.error('❌ Error deleting avatar:', error);
    return {
      success: false,
      message: error.message,
    };
  }
}
