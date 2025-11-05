/**
 * Avatar Processor
 * Автоматически обрабатывает загруженные аватары:
 * - Создает квадратный thumbnail 256x256
 * - Обновляет Firestore и Firebase Auth
 * - Удаляет оригинал
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as sharp from 'sharp';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const storage = new Storage();

/**
 * Storage триггер: обрабатывает загруженные аватары
 *
 * Путь: avatars/{userId}/original
 * Создает: avatars/{userId}/thumbnail_256x256.jpg
 * Обновляет: Firestore users/{userId} и Auth photoURL
 */
export const processAvatar = functions
  .region('us-central1')
  .storage
  .object()
  .onFinalize(async (object) => {
  const filePath = object.name; // avatars/{userId}/original
  const contentType = object.contentType;
  const bucket = storage.bucket(object.bucket);

  console.log('🖼️ Storage trigger fired for:', filePath);

  // 1. Проверка: это аватар?
  if (!filePath || !filePath.startsWith('avatars/')) {
    console.log('⏭️ Not an avatar, skipping');
    return null;
  }

  // 2. Проверка: это не thumbnail?
  if (filePath.includes('thumbnail_')) {
    console.log('⏭️ Already a thumbnail, skipping');
    return null;
  }

  // 3. Проверка: это изображение?
  if (!contentType || !contentType.startsWith('image/')) {
    console.log('❌ Not an image:', contentType);
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Uploaded file is not an image'
    );
  }

  // 4. Извлечение userId из пути
  // avatars/{userId}/original -> userId
  const pathParts = filePath.split('/');
  if (pathParts.length < 2) {
    console.error('❌ Invalid path structure:', filePath);
    return null;
  }
  const userId = pathParts[1];

  console.log(`👤 Processing avatar for user: ${userId}`);

  // 5. Создание временных файлов
  const fileName = path.basename(filePath);
  const tempFilePath = path.join(os.tmpdir(), fileName);
  const thumbnailFileName = 'thumbnail_256x256.jpg';
  const thumbnailFilePath = path.join(os.tmpdir(), thumbnailFileName);
  const thumbnailStoragePath = `avatars/${userId}/${thumbnailFileName}`;

  try {
    // 6. Скачать оригинал во временную папку
    console.log('⬇️ Downloading original from Storage...');
    await bucket.file(filePath).download({ destination: tempFilePath });
    console.log('✅ Downloaded to:', tempFilePath);

    // 7. Создать thumbnail с помощью sharp
    console.log('🔧 Creating 256x256 thumbnail...');
    await sharp(tempFilePath)
      .resize(256, 256, {
        fit: 'cover', // Квадратная обрезка по центру
        position: 'center',
      })
      .jpeg({
        quality: 90,
        progressive: true,
      })
      .toFile(thumbnailFilePath);

    console.log('✅ Thumbnail created:', thumbnailFilePath);

    // 8. Загрузить thumbnail обратно в Storage
    console.log('⬆️ Uploading thumbnail to Storage...');
    await bucket.upload(thumbnailFilePath, {
      destination: thumbnailStoragePath,
      metadata: {
        contentType: 'image/jpeg',
        metadata: {
          userId: userId,
          processed: 'true',
          processedAt: new Date().toISOString(),
        },
      },
      public: true, // Сделать публичным для чтения
    });

    console.log('✅ Thumbnail uploaded to:', thumbnailStoragePath);

    // 9. Получить публичный URL
    const thumbnailFile = bucket.file(thumbnailStoragePath);
    await thumbnailFile.makePublic();
    const publicUrl = `https://storage.googleapis.com/${object.bucket}/${thumbnailStoragePath}`;

    console.log('🌐 Public URL:', publicUrl);

    // 10. Обновить Firestore
    console.log('📝 Updating Firestore...');
    await admin.firestore().collection('users').doc(userId).update({
      photoURL: publicUrl,
      avatarUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('✅ Firestore updated');

    // 11. Обновить Firebase Auth
    console.log('🔐 Updating Firebase Auth...');
    await admin.auth().updateUser(userId, {
      photoURL: publicUrl,
    });

    console.log('✅ Auth profile updated');

    // 12. Удалить оригинал (опционально, для экономии места)
    console.log('🗑️ Deleting original file...');
    await bucket.file(filePath).delete();
    console.log('✅ Original deleted');

    // 13. Очистка временных файлов
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(thumbnailFilePath);
    console.log('🧹 Temp files cleaned up');

    console.log(`✅ Avatar processing complete for user ${userId}`);
    return null;

  } catch (error: any) {
    console.error('❌ Error processing avatar:', error);

    // Очистка временных файлов в случае ошибки
    try {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      if (fs.existsSync(thumbnailFilePath)) fs.unlinkSync(thumbnailFilePath);
    } catch (cleanupError) {
      console.error('⚠️ Cleanup error:', cleanupError);
    }

    throw new functions.https.HttpsError(
      'internal',
      `Failed to process avatar: ${error.message}`
    );
  }
});
