#!/bin/bash
# Budget Protection Setup Script
# Автоматическая настройка защиты от $174+ счетов

set -e

echo "🛡️ Budget Protection Setup Script"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_ID="profit-step"
FUNCTION_NAME="handleBudgetAlert"
REGION="us-central1"
TOPIC_NAME="budget-alerts"
BUDGET_AMOUNT=10

echo -e "${BLUE}Проект:${NC} $PROJECT_ID"
echo -e "${BLUE}Функция:${NC} $FUNCTION_NAME"
echo -e "${BLUE}Регион:${NC} $REGION"
echo -e "${BLUE}Бюджет:${NC} \$$BUDGET_AMOUNT/месяц"
echo ""

# Step 1: Check if gcloud is installed
echo -e "${YELLOW}[1/6]${NC} Проверка gcloud CLI..."
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI не установлен${NC}"
    echo ""
    echo "Установка gcloud CLI:"
    echo "1. gcloud уже скачан в /tmp/google-cloud-sdk"
    echo "2. Запустите: /tmp/google-cloud-sdk/install.sh"
    echo "3. Выполните: source ~/.zshrc (или ~/.bash_profile)"
    echo "4. Запустите: gcloud init"
    echo "5. Запустите этот скрипт снова"
    exit 1
fi

echo -e "${GREEN}✅ gcloud CLI установлен${NC}"
gcloud --version | head -1

# Step 2: Check authentication
echo ""
echo -e "${YELLOW}[2/6]${NC} Проверка аутентификации..."
if ! gcloud auth list 2>&1 | grep -q "ACTIVE"; then
    echo -e "${RED}❌ Не авторизован${NC}"
    echo "Запустите: gcloud auth login"
    exit 1
fi

ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)")
echo -e "${GREEN}✅ Авторизован как:${NC} $ACTIVE_ACCOUNT"

# Step 3: Set project
echo ""
echo -e "${YELLOW}[3/6]${NC} Установка проекта..."
gcloud config set project $PROJECT_ID
echo -e "${GREEN}✅ Проект установлен:${NC} $PROJECT_ID"

# Step 4: Enable required APIs
echo ""
echo -e "${YELLOW}[4/6]${NC} Включение необходимых API..."
echo "   - Cloud Functions API"
gcloud services enable cloudfunctions.googleapis.com --quiet
echo "   - Cloud Build API"
gcloud services enable cloudbuild.googleapis.com --quiet
echo "   - Cloud Billing API"
gcloud services enable cloudbilling.googleapis.com --quiet
echo "   - Pub/Sub API"
gcloud services enable pubsub.googleapis.com --quiet
echo -e "${GREEN}✅ Все API включены${NC}"

# Step 5: Create Pub/Sub topic if not exists
echo ""
echo -e "${YELLOW}[5/6]${NC} Создание Pub/Sub topic..."
if gcloud pubsub topics describe $TOPIC_NAME --project=$PROJECT_ID &> /dev/null; then
    echo -e "${GREEN}✅ Topic '$TOPIC_NAME' уже существует${NC}"
else
    gcloud pubsub topics create $TOPIC_NAME --project=$PROJECT_ID
    echo -e "${GREEN}✅ Topic '$TOPIC_NAME' создан${NC}"
fi

# Step 6: Deploy Cloud Function
echo ""
echo -e "${YELLOW}[6/6]${NC} Деплой Auto-Shutoff Cloud Function..."
cd billing-shutdown-function

if [ ! -f "index.js" ] || [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Файлы функции не найдены${NC}"
    echo "Убедитесь что вы в папке profit-step"
    exit 1
fi

echo "   Deploying function (это займет 2-3 минуты)..."
gcloud functions deploy $FUNCTION_NAME \
    --gen2 \
    --runtime=nodejs20 \
    --region=$REGION \
    --source=. \
    --entry-point=$FUNCTION_NAME \
    --trigger-topic=$TOPIC_NAME \
    --set-env-vars=GCP_PROJECT=$PROJECT_ID \
    --quiet

echo -e "${GREEN}✅ Функция задеплоена!${NC}"

# Get service account email
echo ""
echo -e "${BLUE}Получение service account...${NC}"
SA_EMAIL=$(gcloud functions describe $FUNCTION_NAME --region=$REGION --gen2 --format="value(serviceConfig.serviceAccountEmail)")
echo -e "${GREEN}Service Account:${NC} $SA_EMAIL"

# Step 7: Grant billing permissions
echo ""
echo -e "${YELLOW}[ВАЖНО]${NC} Настройка прав доступа..."
echo ""
echo "Функция нуждается в правах для отключения billing."
echo "Выполните следующую команду вручную:"
echo ""
echo -e "${BLUE}gcloud projects add-iam-policy-binding $PROJECT_ID \\${NC}"
echo -e "${BLUE}  --member=serviceAccount:$SA_EMAIL \\${NC}"
echo -e "${BLUE}  --role=roles/billing.projectManager${NC}"
echo ""
echo "Или через Console:"
echo "1. Откройте: https://console.cloud.google.com/iam-admin/iam?project=$PROJECT_ID"
echo "2. Найдите: $SA_EMAIL"
echo "3. Добавьте роль: Billing Project Manager"
echo ""

# Step 8: Test function
echo ""
echo -e "${YELLOW}[ОПЦИОНАЛЬНО]${NC} Тестирование функции..."
echo "Хотите отправить тестовое сообщение? (y/n)"
read -r RESPONSE
if [[ "$RESPONSE" =~ ^[Yy]$ ]]; then
    echo "Отправка тестового сообщения с 50% бюджета (не отключит billing)..."
    gcloud pubsub topics publish $TOPIC_NAME \
        --message='{"costAmount":5,"budgetAmount":10,"budgetDisplayName":"test-budget"}' \
        --project=$PROJECT_ID

    echo ""
    echo "Проверьте логи через 10 секунд:"
    echo "gcloud functions logs read $FUNCTION_NAME --region=$REGION --gen2 --limit=10"
fi

# Summary
echo ""
echo -e "${GREEN}=================================="
echo "✅ НАСТРОЙКА ЗАВЕРШЕНА!"
echo "==================================${NC}"
echo ""
echo "Что установлено:"
echo "  ✅ Cloud Function: $FUNCTION_NAME"
echo "  ✅ Pub/Sub Topic: $TOPIC_NAME"
echo "  ✅ Регион: $REGION"
echo "  ✅ Runtime: Node.js 20"
echo ""
echo "Следующие шаги:"
echo "  1. Настройте права (инструкция выше)"
echo "  2. Создайте Budget в Console:"
echo "     https://console.cloud.google.com/billing/budgets"
echo "  3. Подключите Pub/Sub topic: $TOPIC_NAME"
echo ""
echo "Мониторинг:"
echo "  • Логи функции:"
echo "    gcloud functions logs read $FUNCTION_NAME --region=$REGION --gen2"
echo "  • Billing:"
echo "    https://console.cloud.google.com/billing"
echo ""
echo -e "${GREEN}Защита активирована! 🛡️${NC}"
