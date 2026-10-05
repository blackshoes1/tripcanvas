// 생성 파일 — copy/j-source.json·j-tones.json·j-variants.json에서 npm run copy:build로 만든다.
// @ts-check
(function(root){
  'use strict';
  /** @typedef {'FRIENDLY'|'CASUAL'|'POLITE'} JTone */
  /** @type {Record<string,Record<JTone,string>>} */
  const catalogue={
  "reason.saveEnergy": {
    "FRIENDLY": "지금은 체력을 아끼는 편이 나아요",
    "CASUAL": "지금은 체력을 아끼는 편이 나아",
    "POLITE": "지금은 체력을 아끼시는 편이 낫겠습니다"
  },
  "reason.restHere": {
    "FRIENDLY": "숙소 위치를 몰라 지금 있는 곳에서 쉬는 쪽을 먼저 보여 드려요",
    "CASUAL": "숙소 위치를 몰라 지금 있는 곳에서 쉬는 쪽을 먼저 보여줄게",
    "POLITE": "숙소 위치를 알 수 없어 지금 계신 곳에서 쉬는 쪽을 먼저 보여 드립니다"
  },
  "reason.longTravel": {
    "FRIENDLY": "오늘 이동이 {hours}시간을 넘었어요",
    "CASUAL": "오늘 이동이 {hours}시간을 넘었어",
    "POLITE": "오늘 이동이 {hours}시간을 넘었습니다"
  },
  "reason.noRemaining": {
    "FRIENDLY": "남은 일정이 없어 쉬어도 밀리지 않아요",
    "CASUAL": "남은 일정이 없어 쉬어도 밀리지 않아",
    "POLITE": "남은 일정이 없어 쉬셔도 밀리지 않습니다"
  },
  "reason.slack": {
    "FRIENDLY": "{place}까지 {duration} 여유가 있어요",
    "CASUAL": "{place}까지 {duration} 여유가 있어",
    "POLITE": "{place}까지 {duration} 여유가 있습니다"
  },
  "reason.restDelay": {
    "FRIENDLY": "쉬는 만큼 {subject} 늦어져요",
    "CASUAL": "쉬는 만큼 {subject} 늦어져",
    "POLITE": "쉬시는 만큼 {subject} 늦어집니다"
  },
  "reason.hotelRest": {
    "FRIENDLY": "숙소에서 쉬었다가 이어가도 돼요",
    "CASUAL": "숙소에서 쉬었다가 이어가도 돼",
    "POLITE": "숙소에서 쉬셨다가 이어가셔도 됩니다"
  },
  "reason.muchTravel": {
    "FRIENDLY": "오늘 이동이 많았어요",
    "CASUAL": "오늘 이동이 많았어",
    "POLITE": "오늘 이동이 많았습니다"
  },
  "reason.hotelSlack": {
    "FRIENDLY": "숙소에 들렀다 가도 {place} 시간에는 여유가 있어요",
    "CASUAL": "숙소에 들렀다 가도 {place} 시간에는 여유가 있어",
    "POLITE": "숙소에 들렀다 가셔도 {place} 시간에는 여유가 있습니다"
  },
  "reason.hotelDelay": {
    "FRIENDLY": "숙소에 들르면 {subject} 늦어질 수 있어요",
    "CASUAL": "숙소에 들르면 {subject} 늦어질 수 있어",
    "POLITE": "숙소에 들르시면 {subject} 늦어질 수 있습니다"
  },
  "reason.hotelRemaining": {
    "FRIENDLY": "오늘 남은 일정을 숙소에서 이어가도 돼요",
    "CASUAL": "오늘 남은 일정을 숙소에서 이어가도 돼",
    "POLITE": "오늘 남은 일정을 숙소에서 이어가셔도 됩니다"
  },
  "reason.hungry": {
    "FRIENDLY": "배고프다고 하셨어요 — 식사를 먼저 챙겨요",
    "CASUAL": "배고프다고 했지 — 식사를 먼저 챙겨보자",
    "POLITE": "배고프다고 말씀하셨습니다 — 식사를 먼저 챙기시면 좋겠습니다"
  },
  "reason.lightMeal": {
    "FRIENDLY": "{place} {time}까지 기다리기 어렵다면 가볍게 먹어도 돼요",
    "CASUAL": "{place} {time}까지 기다리기 어렵다면 가볍게 먹어도 돼",
    "POLITE": "{place} {time}까지 기다리기 어려우시면 가볍게 드셔도 됩니다"
  },
  "reason.chooseMeal": {
    "FRIENDLY": "먹을 곳을 골라 지금 일정에 넣을 수 있어요",
    "CASUAL": "먹을 곳을 골라 지금 일정에 넣을 수 있어",
    "POLITE": "드실 곳을 골라 지금 일정에 넣으실 수 있습니다"
  },
  "reason.mealWindow": {
    "FRIENDLY": "{meal} 시간대에 일정이 비어 있어요",
    "CASUAL": "{meal} 시간대에 일정이 비어 있어",
    "POLITE": "{meal} 시간대에 일정이 비어 있습니다"
  },
  "reason.mealSafe": {
    "FRIENDLY": "이 시간에 식사를 넣으면 남은 일정이 밀리지 않아요",
    "CASUAL": "이 시간에 식사를 넣으면 남은 일정이 밀리지 않아",
    "POLITE": "이 시간에 식사를 넣으시면 남은 일정이 밀리지 않습니다"
  },
  "reason.open": {
    "FRIENDLY": "도착 예정 시각에 문을 열어요",
    "CASUAL": "도착 예정 시각에 문을 열어",
    "POLITE": "도착 예정 시각에 문을 엽니다"
  },
  "reason.lively": {
    "FRIENDLY": "컨디션이 좋을 때 오래 둘러보기 좋은 곳이에요",
    "CASUAL": "컨디션이 좋을 때 오래 둘러보기 좋은 곳이야",
    "POLITE": "컨디션이 좋으실 때 오래 둘러보기 좋은 곳입니다"
  },
  "reason.must": {
    "FRIENDLY": "꼭 가려고 표시한 곳이에요",
    "CASUAL": "꼭 가려고 표시한 곳이야",
    "POLITE": "꼭 가시려고 표시한 곳입니다"
  },
  "reason.inPlan": {
    "FRIENDLY": "원래 오늘 일정에 있던 곳이에요",
    "CASUAL": "원래 오늘 일정에 있던 곳이야",
    "POLITE": "원래 오늘 일정에 있던 곳입니다"
  },
  "reason.moveDay": {
    "FRIENDLY": "Day {day} 일정에서 옮겨올 수 있어요",
    "CASUAL": "Day {day} 일정에서 옮겨올 수 있어",
    "POLITE": "Day {day} 일정에서 옮겨오실 수 있습니다"
  },
  "reason.far": {
    "FRIENDLY": "다만 이동이 조금 길어요",
    "CASUAL": "다만 이동이 조금 길어",
    "POLITE": "다만 이동이 조금 깁니다"
  },
  "reason.onWay": {
    "FRIENDLY": "다음 일정 {place} 가는 길에 들를 수 있어요",
    "CASUAL": "다음 일정 {place} 가는 길에 들를 수 있어",
    "POLITE": "다음 일정 {place} 가시는 길에 들르실 수 있습니다"
  },
  "reason.duration": {
    "FRIENDLY": "약 {duration}이면 둘러볼 수 있어요",
    "CASUAL": "약 {duration}이면 둘러볼 수 있어",
    "POLITE": "약 {duration}이면 둘러보실 수 있습니다"
  },
  "replan.late": {
    "FRIENDLY": "이대로면 {place} {time} 예약에 {duration} 늦어요",
    "CASUAL": "이대로면 {place} {time} 예약에 {duration} 늦어",
    "POLITE": "이대로면 {place} {time} 예약에 {duration} 늦습니다"
  },
  "replan.dropFits": {
    "FRIENDLY": "{object} 빼면 {place} 예약 시간에 맞출 수 있어요",
    "CASUAL": "{object} 빼면 {place} 예약 시간에 맞출 수 있어",
    "POLITE": "{object} 빼시면 {place} 예약 시간에 맞추실 수 있습니다"
  },
  "replan.dropFitsAny": {
    "FRIENDLY": "{object} 빼면 예약 시간에 맞출 수 있어요",
    "CASUAL": "{object} 빼면 예약 시간에 맞출 수 있어",
    "POLITE": "{object} 빼시면 예약 시간에 맞추실 수 있습니다"
  },
  "replan.stillLate": {
    "FRIENDLY": "{object} 빼도 {duration}쯤 늦어요 — 예약 시간을 바꾸거나 미리 알려 두는 편이 나아요",
    "CASUAL": "{object} 빼도 {duration}쯤 늦어 — 예약 시간을 바꾸거나 미리 알려 두는 편이 나아",
    "POLITE": "{object} 빼셔도 {duration}쯤 늦습니다 — 예약 시간을 바꾸시거나 미리 알려 두시는 편이 낫겠습니다"
  },
  "replan.arrival": {
    "FRIENDLY": "남은 일정을 지금부터 이어 가면 {place}에 {time}쯤 닿아요",
    "CASUAL": "남은 일정을 지금부터 이어 가면 {place}에 {time}쯤 닿아",
    "POLITE": "남은 일정을 지금부터 이어 가시면 {place}에 {time}쯤 도착하십니다"
  },
  "replan.simulated": {
    "FRIENDLY": "남은 일정을 지금부터 다시 이어 봤어요",
    "CASUAL": "남은 일정을 지금부터 다시 이어 봤어",
    "POLITE": "남은 일정을 지금부터 다시 이어 보았습니다"
  },
  "replan.fixed": {
    "FRIENDLY": "예약 시각은 그대로 지켜요",
    "CASUAL": "예약 시각은 그대로 지켜",
    "POLITE": "예약 시각은 그대로 유지합니다"
  },
  "replan.visited": {
    "FRIENDLY": "다녀온 곳은 그대로 둬요",
    "CASUAL": "다녀온 곳은 그대로 둬",
    "POLITE": "다녀오신 곳은 그대로 둡니다"
  },
  "suggest.meal": {
    "FRIENDLY": "{time}부터 식사를 넣을 수 있어요",
    "CASUAL": "{time}부터 식사를 넣을 수 있어",
    "POLITE": "{time}부터 식사를 넣으실 수 있습니다"
  },
  "suggest.restFits": {
    "FRIENDLY": "지금 쉬어도 남은 일정에는 여유가 있어요",
    "CASUAL": "지금 쉬어도 남은 일정에는 여유가 있어",
    "POLITE": "지금 쉬셔도 남은 일정에는 여유가 있습니다"
  },
  "suggest.restDelays": {
    "FRIENDLY": "쉬는 만큼 남은 일정이 늦어져요 — 무리하지 않는 쪽이 나아요",
    "CASUAL": "쉬는 만큼 남은 일정이 늦어져 — 무리하지 않는 쪽이 나아",
    "POLITE": "쉬시는 만큼 남은 일정이 늦어집니다 — 무리하지 않으시는 쪽이 낫겠습니다"
  },
  "replan.noneDroppable": {
    "FRIENDLY": "{late} — 뺄 수 있는 일정이 없어요. 예약 시간을 바꾸거나 미리 알려 두는 편이 나아요",
    "CASUAL": "{late} — 뺄 수 있는 일정이 없어. 예약 시간을 바꾸거나 미리 알려 두는 편이 나아",
    "POLITE": "{late} — 뺄 수 있는 일정이 없습니다. 예약 시간을 바꾸시거나 미리 알려 두시는 편이 낫겠습니다"
  },
  "replan.moveNote": {
    "FRIENDLY": "{topic} 다음 날 앞쪽으로 옮겨요",
    "CASUAL": "{topic} 다음 날 앞쪽으로 옮겨",
    "POLITE": "{topic} 다음 날 앞쪽으로 옮깁니다"
  },
  "replan.skipNote": {
    "FRIENDLY": "{topic} '건너뜀'으로 표시해요",
    "CASUAL": "{topic} '건너뜀'으로 표시해",
    "POLITE": "{topic} '건너뜀'으로 표시합니다"
  },
  "departure.planned": {
    "FRIENDLY": "{time}쯤 출발하는 일정이에요",
    "CASUAL": "{time}쯤 출발하는 일정이야",
    "POLITE": "{time}쯤 출발하는 일정입니다"
  },
  "departure.arrival": {
    "FRIENDLY": "지금 출발하면 {time} 도착이에요",
    "CASUAL": "지금 출발하면 {time} 도착이야",
    "POLITE": "지금 출발하시면 {time} 도착입니다"
  },
  "departure.late": {
    "FRIENDLY": "지금 출발해도 약 {duration} 늦어요",
    "CASUAL": "지금 출발해도 약 {duration} 늦어",
    "POLITE": "지금 출발하셔도 약 {duration} 늦습니다"
  },
  "departure.slack": {
    "FRIENDLY": "지금 출발하면 약 {minutes}분 여유가 있어요",
    "CASUAL": "지금 출발하면 약 {minutes}분 여유가 있어",
    "POLITE": "지금 출발하시면 약 {minutes}분 여유가 있습니다"
  },
  "departure.tight": {
    "FRIENDLY": "지금 바로 나서야 {time} 예약에 맞춰요",
    "CASUAL": "지금 바로 나서야 {time} 예약에 맞춰",
    "POLITE": "지금 바로 나서셔야 {time} 예약에 맞추실 수 있습니다"
  },
  "departure.early": {
    "FRIENDLY": "{leave}쯤 출발하면 {time} 예약에 맞춰요 · 그 전까지 {duration} 여유가 있어요",
    "CASUAL": "{leave}쯤 출발하면 {time} 예약에 맞춰 · 그 전까지 {duration} 여유가 있어",
    "POLITE": "{leave}쯤 출발하시면 {time} 예약에 맞추실 수 있습니다 · 그 전까지 {duration} 여유가 있습니다"
  },
  "departure.risk": {
    "FRIENDLY": "지금 출발해도 {duration}쯤 늦어요",
    "CASUAL": "지금 출발해도 {duration}쯤 늦어",
    "POLITE": "지금 출발하셔도 {duration}쯤 늦습니다"
  },
  "departure.tell": {
    "FRIENDLY": "{late} — {place}에 미리 알려두면 좋겠어요",
    "CASUAL": "{late} — {place}에 미리 알려두면 좋겠어",
    "POLITE": "{late} — {place}에 미리 알려 두시면 좋겠습니다"
  },
  "departure.exact": {
    "FRIENDLY": "지금 움직이면 {time}까지 딱 맞아요",
    "CASUAL": "지금 움직이면 {time}까지 딱 맞아",
    "POLITE": "지금 움직이시면 {time}까지 딱 맞습니다"
  },
  "departure.ready": {
    "FRIENDLY": "이제 출발하면 여유 있게 도착할 수 있어요 (약 {travel} 거리)",
    "CASUAL": "이제 출발하면 여유 있게 도착할 수 있어 (약 {travel} 거리)",
    "POLITE": "이제 출발하시면 여유 있게 도착하실 수 있습니다 (약 {travel} 거리)"
  },
  "departure.upcoming": {
    "FRIENDLY": "{time}쯤 움직이면 여유가 있어요 (약 {travel} 거리, 지금부터 {slack} 남음)",
    "CASUAL": "{time}쯤 움직이면 여유가 있어 (약 {travel} 거리, 지금부터 {slack} 남음)",
    "POLITE": "{time}쯤 움직이시면 여유가 있습니다 (약 {travel} 거리, 지금부터 {slack} 남음)"
  },
  "pulse.noPlan": {
    "FRIENDLY": "오늘은 정해둔 일정이 없어요",
    "CASUAL": "오늘은 정해둔 일정이 없어",
    "POLITE": "오늘은 정해 두신 일정이 없습니다"
  },
  "pulse.noPlanDetail": {
    "FRIENDLY": "지금 상황에 맞는 곳을 골라 시작해도 되고, 그냥 쉬어도 괜찮아요.",
    "CASUAL": "지금 상황에 맞는 곳을 골라 시작해도 되고, 그냥 쉬어도 괜찮아.",
    "POLITE": "지금 상황에 맞는 곳을 골라 시작하셔도 되고, 그냥 쉬셔도 괜찮습니다."
  },
  "pulse.complete": {
    "FRIENDLY": "오늘 계획한 일정은 다 마쳤어요",
    "CASUAL": "오늘 계획한 일정은 다 마쳤어",
    "POLITE": "오늘 계획하신 일정은 모두 마치셨습니다"
  },
  "pulse.completeDetail": {
    "FRIENDLY": "남은 시간은 편하게 쓰셔도 돼요.",
    "CASUAL": "남은 시간은 편하게 써도 돼.",
    "POLITE": "남은 시간은 편하게 쓰셔도 됩니다."
  },
  "pulse.attention": {
    "FRIENDLY": "일정을 조금 손보면 좋겠어요",
    "CASUAL": "일정을 조금 손보면 좋겠어",
    "POLITE": "일정을 조금 손보시면 좋겠습니다"
  },
  "pulse.deadline": {
    "FRIENDLY": "이대로면 예약 시간을 지키기 어려워요.",
    "CASUAL": "이대로면 예약 시간을 지키기 어려워.",
    "POLITE": "이대로면 예약 시간을 지키기 어렵습니다."
  },
  "pulse.delayedDetail": {
    "FRIENDLY": "서두르기보다 도착 시각을 알려두는 편이 나을 수 있어요.",
    "CASUAL": "서두르기보다 도착 시각을 알려두는 편이 나을 수 있어.",
    "POLITE": "서두르시기보다 도착 시각을 알려 두시는 편이 나을 수 있습니다."
  },
  "pulse.resting": {
    "FRIENDLY": "지금은 쉬어가는 중이에요",
    "CASUAL": "지금은 쉬어가는 중이야",
    "POLITE": "지금은 쉬어가시는 중입니다"
  },
  "pulse.restingDetail": {
    "FRIENDLY": "무리하지 않는 선에서 이어가면 돼요.",
    "CASUAL": "무리하지 않는 선에서 이어가면 돼.",
    "POLITE": "무리하지 않으시는 선에서 이어가시면 됩니다."
  },
  "pulse.ahead": {
    "FRIENDLY": "계획보다 앞서 가고 있어요",
    "CASUAL": "계획보다 앞서 가고 있어",
    "POLITE": "계획보다 앞서 가고 계십니다"
  },
  "pulse.aheadDetail": {
    "FRIENDLY": "다음 일정까지 여유가 있어요.",
    "CASUAL": "다음 일정까지 여유가 있어.",
    "POLITE": "다음 일정까지 여유가 있습니다."
  },
  "pulse.onTrack": {
    "FRIENDLY": "일정대로 잘 가고 있어요",
    "CASUAL": "일정대로 잘 가고 있어",
    "POLITE": "일정대로 잘 가고 계십니다"
  },
  "notification.replan": {
    "FRIENDLY": "일정을 조금 손보면 어떨까요",
    "CASUAL": "일정을 조금 손보면 어떨까",
    "POLITE": "일정을 조금 손보시면 어떨까요"
  },
  "notification.empty": {
    "FRIENDLY": "지금 들르기 좋은 곳이 있어요",
    "CASUAL": "지금 들르기 좋은 곳이 있어",
    "POLITE": "지금 들르시기 좋은 곳이 있습니다"
  },
  "notification.price": {
    "FRIENDLY": "같은 조건이 더 싼 곳이 있어요.",
    "CASUAL": "같은 조건이 더 싼 곳이 있어.",
    "POLITE": "같은 조건이 더 저렴한 곳이 있습니다."
  },
  "pulse.lateAt": {
    "FRIENDLY": "이대로면 {place} {time} 예약에 {duration} 늦어요.",
    "CASUAL": "이대로면 {place} {time} 예약에 {duration} 늦어.",
    "POLITE": "이대로면 {place} {time} 예약에 {duration} 늦습니다."
  },
  "pulse.late": {
    "FRIENDLY": "이대로면 예약 시간에 {duration} 늦어요.",
    "CASUAL": "이대로면 예약 시간에 {duration} 늦어.",
    "POLITE": "이대로면 예약 시간에 {duration} 늦습니다."
  },
  "pulse.delayed": {
    "FRIENDLY": "약 {duration} 늦어지고 있어요",
    "CASUAL": "약 {duration} 늦어지고 있어",
    "POLITE": "약 {duration} 늦어지고 있습니다"
  },
  "pulse.free": {
    "FRIENDLY": "다음 일정까지 {duration} 여유가 있어요",
    "CASUAL": "다음 일정까지 {duration} 여유가 있어",
    "POLITE": "다음 일정까지 {duration} 여유가 있습니다"
  },
  "pulse.freeDetail": {
    "FRIENDLY": "{place} {time}까지는 시간이 넉넉해요.",
    "CASUAL": "{place} {time}까지는 시간이 넉넉해.",
    "POLITE": "{place} {time}까지는 시간이 넉넉합니다."
  },
  "pulse.next": {
    "FRIENDLY": "{place}까지 이어가면 돼요.",
    "CASUAL": "{place}까지 이어가면 돼.",
    "POLITE": "{place}까지 이어가시면 됩니다."
  },
  "notification.lateAt": {
    "FRIENDLY": "이대로면 {place} 예약에 {duration} 늦어요.",
    "CASUAL": "이대로면 {place} 예약에 {duration} 늦어.",
    "POLITE": "이대로면 {place} 예약에 {duration} 늦습니다."
  },
  "notification.late": {
    "FRIENDLY": "이대로면 예약에 {duration} 늦어요.",
    "CASUAL": "이대로면 예약에 {duration} 늦어.",
    "POLITE": "이대로면 예약에 {duration} 늦습니다."
  },
  "notification.dropLate": {
    "FRIENDLY": "{object} 빼도 늦어요 — 예약 시간을 확인해 보세요.",
    "CASUAL": "{object} 빼도 늦어 — 예약 시간을 확인해 보면 좋겠어.",
    "POLITE": "{object} 빼셔도 늦습니다 — 예약 시간을 확인해 보시면 좋겠습니다."
  },
  "notification.dropFits": {
    "FRIENDLY": "{object} 빼면 예약 시간은 그대로 지킬 수 있어요.",
    "CASUAL": "{object} 빼면 예약 시간은 그대로 지킬 수 있어.",
    "POLITE": "{object} 빼시면 예약 시간은 그대로 지키실 수 있습니다."
  },
  "notification.check": {
    "FRIENDLY": "남은 일정을 다시 확인해 보세요.",
    "CASUAL": "남은 일정을 다시 확인해 보면 좋겠어.",
    "POLITE": "남은 일정을 다시 확인해 보시면 좋겠습니다."
  },
  "intent.rest": {
    "FRIENDLY": "쉬고 싶다고 하셨어요",
    "CASUAL": "쉬고 싶다고 했지",
    "POLITE": "쉬고 싶다고 말씀하셨습니다"
  },
  "intent.walk": {
    "FRIENDLY": "많이 걷지 않는 쪽으로 볼게요",
    "CASUAL": "많이 걷지 않는 쪽으로 볼게",
    "POLITE": "많이 걷지 않는 쪽으로 살펴보겠습니다"
  },
  "intent.near": {
    "FRIENDLY": "가까운 곳만 볼게요",
    "CASUAL": "가까운 곳만 볼게",
    "POLITE": "가까운 곳만 살펴보겠습니다"
  },
  "intent.energy": {
    "FRIENDLY": "컨디션이 좋다고 하셨어요",
    "CASUAL": "컨디션이 좋다고 했지",
    "POLITE": "컨디션이 좋다고 말씀하셨습니다"
  },
  "intent.meal": {
    "FRIENDLY": "식사를 먼저 챙길게요",
    "CASUAL": "식사를 먼저 챙길게",
    "POLITE": "식사를 먼저 챙기겠습니다"
  },
  "intent.hotel": {
    "FRIENDLY": "숙소로 돌아가는 쪽을 먼저 볼게요",
    "CASUAL": "숙소로 돌아가는 쪽을 먼저 볼게",
    "POLITE": "숙소로 돌아가시는 쪽을 먼저 살펴보겠습니다"
  },
  "tone.preview": {
    "FRIENDLY": "많이 걸었네요. 잠깐 쉬어갈까요?",
    "CASUAL": "많이 걸었네. 잠깐 쉬어갈까?",
    "POLITE": "많이 걸으셨네요. 잠시 쉬어가시면 어떨까요?"
  },
  "kicker.next": {
    "FRIENDLY": "지금 한 곳 더 들를 수 있어요",
    "CASUAL": "지금 한 곳 더 들를 수 있어",
    "POLITE": "지금 한 곳 더 들르실 수 있습니다"
  },
  "kicker.rest": {
    "FRIENDLY": "쉬어도 괜찮아요",
    "CASUAL": "쉬어도 괜찮아",
    "POLITE": "쉬셔도 괜찮습니다"
  },
  "flow.today": {
    "FRIENDLY": "오늘 이렇게 이어가면 어떨까요",
    "CASUAL": "오늘 이렇게 이어가면 어떨까",
    "POLITE": "오늘 이렇게 이어가시면 어떨까요"
  },
  "flow.preview": {
    "FRIENDLY": "이 날을 이렇게 채우면 어떨까요",
    "CASUAL": "이 날을 이렇게 채우면 어떨까",
    "POLITE": "이 날을 이렇게 채우시면 어떨까요"
  },
  "flow.blocked": {
    "FRIENDLY": "이대로면 예약 시간에 늦어서 더 넣지 않았어요 — 일정 조정 제안을 먼저 확인해 주세요.",
    "CASUAL": "이대로면 예약 시간에 늦어서 더 넣지 않았어 — 일정 조정 제안을 먼저 확인해 보면 좋겠어.",
    "POLITE": "이대로면 예약 시간에 늦어 더 넣지 않았습니다 — 일정 조정 제안을 먼저 확인해 보시면 좋겠습니다."
  },
  "flow.blockedNoCard": {
    "FRIENDLY": "이대로면 예약 시간에 늦어서 더 넣지 않았어요 — 예약 시간을 바꾸거나 미리 알려 두는 편이 나아요.",
    "CASUAL": "이대로면 예약 시간에 늦어서 더 넣지 않았어 — 예약 시간을 바꾸거나 미리 알려 두는 편이 나아.",
    "POLITE": "이대로면 예약 시간에 늦어 더 넣지 않았습니다 — 예약 시간을 바꾸시거나 미리 알려 두시는 편이 낫겠습니다."
  },
  "flow.empty": {
    "FRIENDLY": "지금 더 넣을 만한 곳이 없어요 — 남은 일정을 그대로 이어가면 돼요.",
    "CASUAL": "지금 더 넣을 만한 곳이 없어 — 남은 일정을 그대로 이어가면 돼.",
    "POLITE": "지금 더 넣을 만한 곳이 없습니다 — 남은 일정을 그대로 이어가시면 됩니다."
  },
  "flow.light": {
    "FRIENDLY": "이 날 메모가 가벼운 일정이라 한 곳만 골랐어요.",
    "CASUAL": "이 날 메모가 가벼운 일정이라 한 곳만 골랐어.",
    "POLITE": "이 날 메모가 가벼운 일정이라 한 곳만 골랐습니다."
  },
  "flow.dismissed": {
    "FRIENDLY": "알겠어요 — 일정은 그대로 둬요",
    "CASUAL": "알겠어 — 일정은 그대로 둘게",
    "POLITE": "알겠습니다 — 일정은 그대로 둡니다"
  },
  "suggest.afterTrip": {
    "FRIENDLY": "지난 여행이에요 — 일정을 돌아볼 수 있고, J의 제안은 여행 전과 여행 중에 드려요.",
    "CASUAL": "지난 여행이야 — 일정을 돌아볼 수 있고, J의 제안은 여행 전과 여행 중에 해줄게.",
    "POLITE": "지난 여행입니다 — 일정을 돌아보실 수 있고, J의 제안은 여행 전과 여행 중에 드립니다."
  },
  "suggest.past": {
    "FRIENDLY": "지난 날이에요 — 다녀온 곳은 아래 목록에서 표시할 수 있어요.",
    "CASUAL": "지난 날이야 — 다녀온 곳은 아래 목록에서 표시할 수 있어.",
    "POLITE": "지난 날입니다 — 다녀오신 곳은 아래 목록에서 표시하실 수 있습니다."
  },
  "suggest.emptyToday": {
    "FRIENDLY": "지금 새로 제안할 일정이 없어요 — 오늘 남은 일정을 그대로 이어가면 돼요.",
    "CASUAL": "지금 새로 제안할 일정이 없어 — 오늘 남은 일정을 그대로 이어가면 돼.",
    "POLITE": "지금 새로 제안할 일정이 없습니다 — 오늘 남은 일정을 그대로 이어가시면 됩니다."
  },
  "suggest.emptyPreview": {
    "FRIENDLY": "이 날은 더 넣을 만한 곳이 없어요 — 지금 일정 그대로 괜찮아요.",
    "CASUAL": "이 날은 더 넣을 만한 곳이 없어 — 지금 일정 그대로 괜찮아.",
    "POLITE": "이 날은 더 넣을 만한 곳이 없습니다 — 지금 일정 그대로 괜찮습니다."
  },
  "intent.normal": {
    "FRIENDLY": "컨디션은 '보통'으로 보고 있어요 — 다르면 아래 버튼으로 알려 주세요",
    "CASUAL": "컨디션은 '보통'으로 보고 있어 — 다르면 아래 버튼으로 알려줘",
    "POLITE": "컨디션은 '보통'으로 보고 있습니다 — 다르시면 아래 버튼으로 알려 주세요"
  },
  "intent.unknown": {
    "FRIENDLY": "그 문장은 아직 못 알아들었어요 — 아래 컨디션 버튼으로 알려 주세요",
    "CASUAL": "그 문장은 아직 못 알아들었어 — 아래 컨디션 버튼으로 알려줘",
    "POLITE": "그 문장은 아직 이해하지 못했습니다 — 아래 컨디션 버튼으로 알려 주세요"
  },
  "today.rest": {
    "FRIENDLY": "남은 시간은 그냥 쉬어도 좋아요.",
    "CASUAL": "남은 시간은 그냥 쉬어도 좋아.",
    "POLITE": "남은 시간은 그냥 쉬셔도 좋습니다."
  },
  "today.before": {
    "FRIENDLY": "아직 여행 전이에요",
    "CASUAL": "아직 여행 전이야",
    "POLITE": "아직 여행 전입니다"
  },
  "today.prepare": {
    "FRIENDLY": "일정 탭에서 계획을 다듬어 두세요.",
    "CASUAL": "일정 탭에서 계획을 다듬어 두면 좋겠어.",
    "POLITE": "일정 탭에서 계획을 다듬어 두시면 좋겠습니다."
  },
  "suggest.emptyNext": {
    "FRIENDLY": "지금 더 넣을 만한 곳은 없어요 — 다음 일정 {place}({time})로 그대로 이어가면 돼요.",
    "CASUAL": "지금 더 넣을 만한 곳은 없어 — 다음 일정 {place}({time})로 그대로 이어가면 돼.",
    "POLITE": "지금 더 넣을 만한 곳은 없습니다 — 다음 일정 {place}({time})로 그대로 이어가시면 됩니다."
  },
  "intent.echo": {
    "FRIENDLY": "이렇게 이해했어요 — {reasons}",
    "CASUAL": "이렇게 이해했어 — {reasons}",
    "POLITE": "이렇게 이해했습니다 — {reasons}"
  },
  "intent.unchanged": {
    "FRIENDLY": "컨디션은 바꾸지 않았어요 — 지금은 '{energy}'로 보고 있어요",
    "CASUAL": "컨디션은 바꾸지 않았어 — 지금은 '{energy}'로 보고 있어",
    "POLITE": "컨디션은 바꾸지 않았습니다 — 지금은 '{energy}'로 보고 있습니다"
  },
  "price.seller": {
    "FRIENDLY": "{seller}에서 같은 조건이 더 싸요{fee}",
    "CASUAL": "{seller}에서 같은 조건이 더 싸{fee}",
    "POLITE": "{seller}에서 같은 조건이 더 저렴합니다{fee}"
  },
  "price.lower": {
    "FRIENDLY": "예약한 뒤 가격이 내려갔어요",
    "CASUAL": "예약한 뒤 가격이 내려갔어",
    "POLITE": "예약하신 뒤 가격이 내려갔습니다"
  },
  "price.net": {
    "FRIENDLY": "취소 수수료를 빼고도 남는 금액이에요",
    "CASUAL": "취소 수수료를 빼고도 남는 금액이야",
    "POLITE": "취소 수수료를 빼고도 남는 금액입니다"
  },
  "suggest.mealTitle": {
    "FRIENDLY": "{meal} 시간이 비어 있어요",
    "CASUAL": "{meal} 시간이 비어 있어",
    "POLITE": "{meal} 시간이 비어 있습니다"
  },
  "departure.tightArrival": {
    "FRIENDLY": "지금 바로 나서야 {time}에 도착해요",
    "CASUAL": "지금 바로 나서야 {time}에 도착해",
    "POLITE": "지금 바로 나서셔야 {time}에 도착하십니다"
  },
  "departure.earlyArrival": {
    "FRIENDLY": "{leave}쯤 출발하면 {time}에 도착해요 · 그 전까지 {duration} 여유가 있어요",
    "CASUAL": "{leave}쯤 출발하면 {time}에 도착해 · 그 전까지 {duration} 여유가 있어",
    "POLITE": "{leave}쯤 출발하시면 {time}에 도착하십니다 · 그 전까지 {duration} 여유가 있습니다"
  },
  "rest.accepted": {
    "FRIENDLY": "쉬는 중이에요 — 남은 일정은 그대로 둬요",
    "CASUAL": "쉬는 중이야 — 남은 일정은 그대로 둘게",
    "POLITE": "쉬어가시는 중입니다 — 남은 일정은 그대로 둡니다"
  },
  "hotel.accepted": {
    "FRIENDLY": "숙소로 돌아가는 중이에요 — 남은 일정은 그대로 둬요",
    "CASUAL": "숙소로 돌아가는 중이야 — 남은 일정은 그대로 둘게",
    "POLITE": "숙소로 돌아가시는 중입니다 — 남은 일정은 그대로 둡니다"
  },
  "intent.unknownNative": {
    "FRIENDLY": "그 문장은 아직 못 알아들었어요 — 컨디션 버튼으로 알려 주세요",
    "CASUAL": "그 문장은 아직 못 알아들었어 — 컨디션 버튼으로 알려줘",
    "POLITE": "그 문장은 아직 이해하지 못했습니다 — 컨디션 버튼으로 알려 주세요"
  }
};
  const choices=[
  {
    "id": "FRIENDLY",
    "label": "여행 메이트",
    "example": "많이 걸었네요. 잠깐 쉬어갈까요?"
  },
  {
    "id": "CASUAL",
    "label": "찐친",
    "example": "많이 걸었네. 잠깐 쉬어갈까?"
  },
  {
    "id": "POLITE",
    "label": "직장 동료",
    "example": "많이 걸으셨네요. 잠시 쉬어가시면 어떨까요?"
  }
];
  /** @param {unknown} tone @returns {JTone} */
  function normalizeTone(tone){ return tone==='CASUAL'||tone==='POLITE'?tone:'FRIENDLY'; }
  /** @param {string} key @param {Record<string,string|number>=} params @param {unknown=} tone @returns {string} */
  function text(key, params, tone){
    const entry=catalogue[key];
    if(!entry) throw new Error('Unknown J copy key: '+key);
    return entry[normalizeTone(tone)].replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, name)=>{
      if(!params || params[name]==null) throw new Error('Missing J copy parameter: '+key+'.'+name);
      return String(params[name]);
    });
  }
  const API={text,normalizeTone,choices};
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  else root.TC_J_COPY=API;
})(typeof globalThis!=='undefined'?globalThis:window);
