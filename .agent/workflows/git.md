---
description: Git workflow для коммита и пуша изменений
---

# Git Commit & Push

// turbo-all

## После завершения работы:

1. Добавить все изменения:
```bash
git add -A
```

2. Сделать коммит с описательным сообщением:
```bash
git commit -m "feat: описание изменений"
```

3. Запушить на GitHub:
```bash
git push
```

Если ветка новая и нет upstream:
```bash
git push --set-upstream origin <branch-name>
```

## Создание новой ветки:
```bash
git checkout -b feature/<название-фичи>
```

## SSH ключ уже настроен:
- Файл: `~/.ssh/id_ed25519_github`
- Конфиг: `~/.ssh/config` 
- GitHub: ключ "anttww" добавлен к аккаунту @garkorcom
