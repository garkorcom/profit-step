/**
 * Email Service для отправки писем
 *
 * Использует Nodemailer для отправки транзакционных email.
 * Поддерживает Gmail SMTP (для разработки) и SendGrid/другие провайдеры (для production).
 */

import * as nodemailer from 'nodemailer';
import * as cfg from '../config';

import { getInviteEmailTemplate } from './templates/inviteTemplate';
// Интерфейс для данных приглашения
interface InviteEmailData {
  toEmail: string;
  userName: string;
  invitedByName: string;
  role: string;
  companyName: string;
  passwordResetLink: string;
}

/**
 * Создает транспортер для отправки email
 *
 * Для production рекомендуется использовать:
 * - Brevo SMTP (рекомендуется) - 300 писем/день бесплатно ⭐
 * - Mailgun
 * - AWS SES
 *
 * Для разработки можно использовать Gmail с App Password
 *
 * Поддерживает два способа конфигурации:
 * 1. .env файл (рекомендуется с 2024+):
 *    EMAIL_USER, EMAIL_PASSWORD, EMAIL_HOST, EMAIL_PORT
 *
 * 2. Firebase Functions Config (устаревает с марта 2026):
 *    firebase functions:config:set email.user="..." email.password="..."
 *
 * Настройка Brevo:
 * - HOST: smtp-relay.brevo.com
 * - PORT: 587
 * - USER: ваш email для входа в Brevo
 * - PASSWORD: SMTP ключ из https://app.brevo.com/settings/keys/smtp
 */
function createTransporter() {
  // Centralised config — see functions/src/config/
  const emailUser = cfg.EMAIL_USER;
  const emailPassword = cfg.EMAIL_PASSWORD.value();
  const emailHost = cfg.EMAIL_HOST;
  const port = cfg.EMAIL_PORT;
  const emailFrom = cfg.EMAIL_FROM;

  if (!emailUser || !emailPassword) {
    console.warn('⚠️ EMAIL_USER или EMAIL_PASSWORD не настроены');
    console.warn('📧 Email отправка будет пропущена (только логирование)');
    console.warn('💡 Настройте .env файл или используйте: firebase functions:config:set');
    console.warn('🎁 Рекомендуем Brevo: 300 писем/день бесплатно - https://www.brevo.com');
    return null;
  }

  console.log(`📧 Email настроен: ${emailHost}:${port} (user: ${emailUser})`);
  console.log(`📧 From address: ${emailFrom || emailUser}`);

  return {
    transporter: nodemailer.createTransport({
      host: emailHost,
      port: port,
      secure: port === 465, // true для 465, false для других портов
      auth: {
        user: emailUser,
        pass: emailPassword,
      },
    }),
    fromAddress: emailFrom || emailUser,
  };
}

/**
 * Отправляет email приглашение новому пользователю
 *
 * @param data - Данные для отправки приглашения
 * @returns Promise с результатом отправки
 */
export async function sendInviteEmail(data: InviteEmailData): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  try {
    const emailConfig = createTransporter();

    // Если транспортер не настроен, только логируем
    if (!emailConfig) {
      console.log('📧 [DEV MODE] Email would be sent to:', data.toEmail);
      console.log('🔗 Password reset link:', data.passwordResetLink);
      return {
        success: true,
        messageId: 'dev-mode-no-email',
      };
    }

    const { transporter, fromAddress } = emailConfig;

    // Генерируем HTML контент
    const htmlContent = getInviteEmailTemplate(data);

    // Настройки email
    const mailOptions = {
      from: {
        name: 'Profit Step',
        address: fromAddress,
      },
      to: data.toEmail,
      subject: `Приглашение в Profit Step - ${data.companyName}`,
      html: htmlContent,
      // Текстовая версия для клиентов без HTML
      text: `
Здравствуйте, ${data.userName}!

${data.invitedByName} пригласил вас присоединиться к команде в системе Profit Step.

Роль: ${data.role}
Компания: ${data.companyName}

Для начала работы:
1. Перейдите по ссылке ниже для установки пароля
2. Придумайте надежный пароль
3. Войдите в систему используя ваш email: ${data.toEmail}

Ссылка для установки пароля:
${data.passwordResetLink}

⏱️ Ссылка действительна 24 часа.

С уважением,
Команда Profit Step
      `.trim(),
    };

    // Отправляем email
    const info = await transporter.sendMail(mailOptions);

    console.log('✅ Email отправлен:', info.messageId);
    console.log('📬 Получатель:', data.toEmail);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error: any) {
    console.error('❌ Ошибка отправки email:', error);
    return {
      success: false,
      error: error.message || 'Не удалось отправить email',
    };
  }
}

/**
 * НАСТРОЙКА ДЛЯ PRODUCTION:
 *
 * 1. Gmail (для разработки):
 *    - Включите "2-Step Verification" в Google аккаунте
 *    - Создайте App Password: https://myaccount.google.com/apppasswords
 *    - Добавьте в .env:
 *      EMAIL_HOST=smtp.gmail.com
 *      EMAIL_PORT=587
 *      EMAIL_USER=your-email@gmail.com
 *      EMAIL_PASSWORD=your-app-password
 *
 * 2. SendGrid (для production):
 *    - Зарегистрируйтесь на https://sendgrid.com
 *    - Получите API ключ
 *    - Добавьте в Firebase Config:
 *      firebase functions:config:set email.host=smtp.sendgrid.net
 *      firebase functions:config:set email.port=587
 *      firebase functions:config:set email.user=apikey
 *      firebase functions:config:set email.password=YOUR_SENDGRID_API_KEY
 *
 * 3. Настройка переменных в Firebase:
 *    firebase functions:config:set email.user="noreply@yourcompany.com"
 *    firebase functions:config:set email.password="your-password"
 *    firebase functions:config:set email.host="smtp.sendgrid.net"
 *    firebase functions:config:set email.port="587"
 */
