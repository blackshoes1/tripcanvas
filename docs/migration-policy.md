# DB 마이그레이션 정책 — 자동 배포 아래에서

2026-09-19부터 **`main` 머지가 운영 API 배포다**(`docs/nas-deployment.md`). 마이그레이션도 사람 손을 거치지 않고
적용된다. 그래서 "적용해도 되는 변경"의 범위가 전보다 좁아졌다. 이 문서가 그 범위를 정한다.

## 한 줄

**운영 마이그레이션은 하위호환이어야 한다** — 새 스키마 위에서 **옛 코드가 그대로 돌아야** 한다.

## 왜

자동 배포의 순서는 이렇다.

```
이미지 pull → migrate(스키마 먼저) → api·realtime 교체 → 헬스체크
```

- **스키마가 코드보다 먼저다.** 그 사이 몇 초 동안 옛 코드가 새 스키마 위에서 돈다.
- **배포가 실패하면 이미지가 되돌아간다.** 그때도 옛 코드가 새 스키마 위에서 돈다.
- ⚠️ **이미지 롤백은 스키마를 되돌리지 않는다.** `scripts/nas-deploy.sh`는 컨테이너만 이전 SHA로 돌린다.
  파괴적 변경이 한 번 적용되면 되돌아갈 길이 없고, 백업 복원(최대 24시간 전)이 유일한 수단이다.

지금까지의 마이그레이션 14개가 전부 추가형이라 이미지 롤백이 안전했다. 그건 운이었고, 이제 규칙이다.

## 해도 되는 것 (한 배포에 담아도 되는 것)

- 컬럼 **추가** — `NULL` 허용이거나 `DEFAULT`가 있어야 한다(0008이 그렇게 했다)
- 테이블·인덱스 **추가**
- 제약 **추가** — 기존 데이터가 이미 만족할 때만
- 트리거·함수·정책의 `drop` 후 재생성 — 코드 객체라 데이터가 없다(0004가 그렇다)

## 나눠서 해야 하는 것 (expand → contract)

쓰던 컬럼을 지우거나 이름을 바꾸는 일은 **한 배포에 담지 않는다.** 네 번에 나눈다.

```
1) expand    새 컬럼을 더한다. 옛 컬럼은 그대로 둔다.               ← 자동 배포
2) deploy    양쪽에 쓰고 새 쪽을 읽는 코드를 배포한다.               ← 자동 배포
3) backfill  옛 데이터를 새 컬럼으로 옮긴다.                        ← 자동 배포
4) contract  옛 컬럼을 지운다. 그 컬럼을 읽는 코드가 하나도 없을 때. ← 사람이 판단
```

4단계만 파괴적이고, 그때는 **되돌릴 수 없다는 것을 알고** 한다.

## 막히는 것 — `npm run check:migrations`

CI(게이트)가 새 마이그레이션에서 아래를 찾으면 PR이 빨개진다.

| 걸리는 구문 | 왜 |
|---|---|
| `DROP TABLE` · `DROP SCHEMA` · `DROP COLUMN` · `DROP TYPE` | 데이터가 사라지고 롤백이 불가능하다 |
| `TRUNCATE` | 같다 |
| `RENAME COLUMN` · `ALTER TABLE ... RENAME TO` | 옛 코드가 그 이름을 찾는다 |
| `ALTER COLUMN ... SET NOT NULL` | 옛 코드가 그 컬럼 없이 INSERT 한다 |
| `ALTER COLUMN ... TYPE` | 옛 코드의 디코딩이 깨진다 |

정말 4단계를 하는 중이라면 **그 파일에 한 줄로 밝힌다.** 검사는 통과하고, 그 판단은 PR 리뷰에 남는다.

```sql
-- tc:allow-destructive 0020에서 새 컬럼으로 옮겼고 읽는 코드가 없다
alter table trips drop column legacy_start;
```

## 파괴적 변경을 배포하는 날의 절차

자동 배포를 **잠깐 세우고** 사람이 본다.

```bash
ssh nas 'touch ~/tripcanvas/deploy/.deploy-disabled'     # 1. 자동 배포 정지
ssh nas 'cd ~/tripcanvas && sudo /usr/local/bin/docker compose -f deploy/docker-compose.yml run --rm backup sh /backup.sh'
                                                          # 2. 직전 백업을 새로 뜬다(하루 된 것 말고)
# 3. PR을 머지한다 — 이미지는 만들어지지만 NAS는 가만히 있는다
ssh nas '~/tripcanvas/scripts/nas-deploy.sh'              # 4. 손으로, 보면서 배포한다
ssh nas 'rm ~/tripcanvas/deploy/.deploy-disabled'         # 5. 자동 배포 재개
```

## 점검·읽기 전용 모드는 이것과 다르다

`TC_READ_ONLY=1`은 **장애 대응용 비상 브레이크**다(쓰기가 503 `MAINTENANCE`). DB를 지키거나 사고를 멈출 때 쓴다.
배포 실패를 막는 장치가 아니다 — 그건 위의 게이트·헬스체크·롤백이 한다.
