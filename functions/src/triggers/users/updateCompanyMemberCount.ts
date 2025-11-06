import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { executeFullGuard, safeExecute, addUpdateMetadata } from '../../utils/guards';
import { FUNCTION_NAMES, USER_FIELDS, COLLECTIONS } from '../../utils/constants';

export const updateCompanyMemberCount = functions
  .region('us-central1')
  .firestore.document('users/{userId}')
  .onWrite(async (change, context) => {
    const functionName = FUNCTION_NAMES.UPDATE_COMPANY_MEMBER_COUNT;

    return safeExecute({
      functionName,
      context,
      executeFunc: async () => {
        const isCreate = !change.before.exists && change.after.exists;
        const isDelete = change.before.exists && !change.after.exists;

        if (!isCreate && !isDelete) {
          const before = change.before.data();
          const after = change.after.data();

          const guardResult = await executeFullGuard({
            eventId: context.eventId,
            functionName,
            before,
            after,
            fieldsToCheck: [USER_FIELDS.STATUS, USER_FIELDS.COMPANY_ID],
          });

          if (!guardResult.shouldProceed) {
            return null;
          }
        }

        let companyId: string | null = null;
        if (change.after.exists) {
          companyId = change.after.data()?.companyId;
        } else if (change.before.exists) {
          companyId = change.before.data()?.companyId;
        }

        if (!companyId) {
          return null;
        }

        const db = admin.firestore();
        const membersSnapshot = await db
          .collection(COLLECTIONS.USERS)
          .where('companyId', '==', companyId)
          .where('status', '==', 'active')
          .count()
          .get();

        const memberCount = membersSnapshot.data().count;

        const updateData = addUpdateMetadata(
          {
            memberCount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          functionName
        );

        await db.collection(COLLECTIONS.COMPANIES).doc(companyId).update(updateData);

        console.log(`✅ ${functionName}: Updated company ${companyId} member count: ${memberCount}`);
        return null;
      },
    });
  });
