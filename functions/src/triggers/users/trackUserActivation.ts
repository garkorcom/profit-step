import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { executeFullGuard, safeExecute } from '../../utils/guards';
import { FUNCTION_NAMES, USER_FIELDS, COLLECTIONS } from '../../utils/constants';

export const trackUserActivation = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onUpdate(async (change, context) => {
    const functionName = FUNCTION_NAMES.TRACK_USER_ACTIVATION;
    const userId = context.params.userId;

    return safeExecute({
      functionName,
      context,
      executeFunc: async () => {
        const before = change.before.data();
        const after = change.after.data();

        const guardResult = await executeFullGuard({
          eventId: context.eventId,
          functionName,
          before,
          after,
          fieldsToCheck: [USER_FIELDS.TITLE, USER_FIELDS.PHOTO_URL],
        });

        if (!guardResult.shouldProceed) {
          return null;
        }

        const db = admin.firestore();
        const activationRef = db.collection(COLLECTIONS.USER_ACTIVATION).doc(userId);
        const updates: any = {};

        if ((!before.title || before.title === '') && after.title && after.title !== '') {
          updates.profileCompleted = admin.firestore.FieldValue.serverTimestamp();
        }

        if ((!before.photoURL || before.photoURL === '') && after.photoURL && after.photoURL !== '') {
          updates.avatarUploaded = admin.firestore.FieldValue.serverTimestamp();
        }

        if (Object.keys(updates).length > 0) {
          await activationRef.set(updates, { merge: true });
          console.log(`✅ ${functionName}: Updated activation for user ${userId}`);
        }

        return null;
      },
    });
  });
