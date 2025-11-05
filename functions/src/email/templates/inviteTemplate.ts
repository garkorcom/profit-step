/**
 * HTML шаблон для email приглашения
 *
 * Responsive дизайн, совместимый с большинством email клиентов
 */

interface InviteEmailData {
  toEmail: string;
  userName: string;
  invitedByName: string;
  role: string;
  companyName: string;
  passwordResetLink: string;
}

/**
 * Переводит роль на русский язык с описанием
 */
function getRoleDescription(role: string): { title: string; description: string } {
  const roles: Record<string, { title: string; description: string }> = {
    admin: {
      title: 'Администратор',
      description: 'Полный доступ к управлению командой',
    },
    manager: {
      title: 'Менеджер',
      description: 'Управление проектами и задачами',
    },
    estimator: {
      title: 'Сметчик',
      description: 'Создание и редактирование смет',
    },
    guest: {
      title: 'Гость',
      description: 'Только просмотр',
    },
  };

  return roles[role] || { title: role, description: 'Базовый доступ' };
}

/**
 * Генерирует HTML контент для email приглашения
 */
export function getInviteEmailTemplate(data: InviteEmailData): string {
  const roleInfo = getRoleDescription(data.role);

  return `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Приглашение в Profit Step</title>
  <style>
    /* Reset styles */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }

    /* General styles */
    body {
      background-color: #f4f4f7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: #333333;
    }

    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 30px;
      text-align: center;
    }

    .header h1 {
      margin: 0;
      color: #ffffff;
      font-size: 28px;
      font-weight: 600;
    }

    .content {
      padding: 40px 30px;
    }

    .greeting {
      font-size: 18px;
      margin-bottom: 20px;
      color: #333333;
    }

    .message {
      margin-bottom: 30px;
      color: #555555;
      line-height: 1.8;
    }

    .info-box {
      background-color: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 30px 0;
      border-radius: 4px;
    }

    .info-item {
      margin: 10px 0;
    }

    .info-label {
      font-weight: 600;
      color: #333333;
      display: inline-block;
      min-width: 100px;
    }

    .info-value {
      color: #555555;
    }

    .role-badge {
      display: inline-block;
      background-color: #667eea;
      color: #ffffff;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-left: 10px;
    }

    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff !important;
      text-decoration: none;
      padding: 16px 40px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
      box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);
      transition: transform 0.2s;
    }

    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 8px rgba(102, 126, 234, 0.4);
    }

    .steps {
      margin: 30px 0;
    }

    .step {
      margin: 15px 0;
      padding-left: 30px;
      position: relative;
    }

    .step::before {
      content: attr(data-step);
      position: absolute;
      left: 0;
      top: 0;
      width: 24px;
      height: 24px;
      background-color: #667eea;
      color: #ffffff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
    }

    .warning-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }

    .warning-icon {
      color: #ffc107;
      font-size: 20px;
      margin-right: 8px;
    }

    .footer {
      background-color: #f8f9fa;
      padding: 30px;
      text-align: center;
      color: #6c757d;
      font-size: 14px;
    }

    .footer-links {
      margin: 15px 0;
    }

    .footer-link {
      color: #667eea;
      text-decoration: none;
      margin: 0 10px;
    }

    .divider {
      height: 1px;
      background-color: #e9ecef;
      margin: 30px 0;
    }

    /* Responsive */
    @media only screen and (max-width: 600px) {
      .content {
        padding: 30px 20px !important;
      }

      .header h1 {
        font-size: 24px !important;
      }

      .cta-button {
        display: block !important;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td style="padding: 40px 0;">
        <div class="email-container">

          <!-- Header -->
          <div class="header">
            <h1>🚀 Profit Step</h1>
          </div>

          <!-- Content -->
          <div class="content">

            <!-- Greeting -->
            <div class="greeting">
              Здравствуйте, <strong>${data.userName}</strong>!
            </div>

            <!-- Main message -->
            <div class="message">
              <strong>${data.invitedByName}</strong> пригласил вас присоединиться к команде
              <strong>${data.companyName}</strong> в системе управления проектами Profit Step.
            </div>

            <!-- Info box -->
            <div class="info-box">
              <div class="info-item">
                <span class="info-label">Компания:</span>
                <span class="info-value">${data.companyName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Ваша роль:</span>
                <span class="info-value">${roleInfo.title}</span>
                <span class="role-badge">${roleInfo.description}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Email:</span>
                <span class="info-value">${data.toEmail}</span>
              </div>
            </div>

            <!-- Steps -->
            <div class="message">
              <strong>Для начала работы выполните следующие шаги:</strong>
            </div>

            <div class="steps">
              <div class="step" data-step="1">
                <strong>Установите пароль</strong><br>
                Нажмите на кнопку ниже и создайте надежный пароль для вашего аккаунта
              </div>
              <div class="step" data-step="2">
                <strong>Войдите в систему</strong><br>
                Используйте ваш email <code>${data.toEmail}</code> и новый пароль
              </div>
              <div class="step" data-step="3">
                <strong>Начните работу</strong><br>
                Изучите функционал системы и приступайте к работе с командой
              </div>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="${data.passwordResetLink}" class="cta-button">
                Установить пароль
              </a>
            </div>

            <!-- Warning -->
            <div class="warning-box">
              <span class="warning-icon">⏱️</span>
              <strong>Важно:</strong> Ссылка для установки пароля действительна в течение 24 часов.
              Если срок истечет, обратитесь к администратору для повторной отправки приглашения.
            </div>

            <div class="divider"></div>

            <!-- Support -->
            <div class="message" style="font-size: 14px; color: #6c757d;">
              <strong>Возникли вопросы?</strong><br>
              Свяжитесь с <strong>${data.invitedByName}</strong> или администратором вашей компании.
            </div>

          </div>

          <!-- Footer -->
          <div class="footer">
            <div style="margin-bottom: 15px;">
              <strong>Profit Step</strong> - Система управления проектами и сметами
            </div>

            <div class="footer-links">
              <a href="https://profitstep.com" class="footer-link">Сайт</a>
              <a href="https://profitstep.com/help" class="footer-link">Помощь</a>
              <a href="https://profitstep.com/privacy" class="footer-link">Конфиденциальность</a>
            </div>

            <div style="margin-top: 15px; font-size: 12px; color: #adb5bd;">
              © ${new Date().getFullYear()} Profit Step. Все права защищены.<br>
              Это автоматическое письмо, пожалуйста, не отвечайте на него.
            </div>
          </div>

        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
