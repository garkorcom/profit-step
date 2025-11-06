/**
 * Budget Alert Handler - Auto Billing Shutoff
 * Автоматически отключает billing при превышении критического порога (500%)
 */

const { CloudBillingClient } = require('@google-cloud/billing');
const billing = new CloudBillingClient();

/**
 * Обработчик budget alerts из Pub/Sub
 * @param {object} pubsubMessage - Pub/Sub message with budget data
 * @param {object} context - Event context
 */
exports.handleBudgetAlert = async (pubsubMessage, context) => {
  try {
    // Парсим данные из Pub/Sub message
    const pubsubData = JSON.parse(
      Buffer.from(pubsubMessage.data, 'base64').toString()
    );

    const costAmount = pubsubData.costAmount || 0;
    const budgetAmount = pubsubData.budgetAmount || 1;
    const budgetDisplayName = pubsubData.budgetDisplayName || 'Unknown';
    const percentSpent = (costAmount / budgetAmount) * 100;

    console.log('📊 Budget Alert received:');
    console.log(`   Budget: ${budgetDisplayName}`);
    console.log(`   Spent: $${costAmount} / $${budgetAmount}`);
    console.log(`   Percent: ${percentSpent.toFixed(2)}%`);

    // Порог для автоматического отключения
    const CRITICAL_THRESHOLD = 500; // 500% = $50 при бюджете $10

    if (percentSpent >= CRITICAL_THRESHOLD) {
      console.log('🚨 CRITICAL: Budget exceeded 500%! Disabling billing...');

      const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
      const projectName = `projects/${projectId}`;

      console.log(`   Project: ${projectName}`);

      try {
        // Получаем текущую billing info
        const [billingInfo] = await billing.getProjectBillingInfo({
          name: projectName,
        });

        console.log(`   Current billing account: ${billingInfo.billingAccountName}`);

        // Отключаем billing (пустая строка = disabled)
        await billing.updateProjectBillingInfo({
          name: projectName,
          projectBillingInfo: {
            billingAccountName: '', // Empty = disable billing
          },
        });

        console.log('✅ SUCCESS: Billing disabled successfully!');
        console.log('   Your project is now protected from further charges.');
        console.log('   To re-enable, go to: https://console.cloud.google.com/billing');

        return {
          success: true,
          action: 'billing_disabled',
          reason: `Budget exceeded ${CRITICAL_THRESHOLD}%`,
          costAmount,
          budgetAmount,
          percentSpent,
        };
      } catch (error) {
        console.error('❌ ERROR: Failed to disable billing:', error);
        console.error('   You may need to grant additional permissions.');
        console.error('   See: https://cloud.google.com/billing/docs/how-to/notify#cap_disable_billing_to_stop_usage');

        throw error;
      }
    } else {
      console.log(`✅ Budget OK: ${percentSpent.toFixed(2)}% < ${CRITICAL_THRESHOLD}%`);
      console.log('   No action needed.');

      return {
        success: true,
        action: 'no_action',
        reason: 'Budget within limits',
        costAmount,
        budgetAmount,
        percentSpent,
      };
    }
  } catch (error) {
    console.error('❌ ERROR in handleBudgetAlert:', error);
    throw error;
  }
};
