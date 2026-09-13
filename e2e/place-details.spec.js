const {test,expect}=require('@playwright/test');
const {prepare,createTrip}=require('./helpers');

async function start(context,page){await prepare(context);await page.goto('/');await createTrip(page,'장소 살펴보기');}
async function googleMock(page){
  await page.evaluate(()=>{
    window.__fields=[];
    window.google={maps:{importLibrary:async()=>({Place:class{
      constructor({id}){this.id=id;}
      async fetchFields({fields}){
        window.__fields.push(fields);
        Object.assign(this,{displayName:'샘플 카페',formattedAddress:'도쿄 1번지',nationalPhoneNumber:'03-1234',rating:4.5,userRatingCount:42,
          regularOpeningHours:{weekdayDescriptions:['월요일: 09:00–18:00']},websiteURI:'javascript:alert(1)',
          reviews:[{text:'<img src=x onerror=alert(1)>',rating:5,authorAttribution:{displayName:'방문자',uri:'https://example.com/author'},googleMapsURI:'https://example.com/review'}]});
      }
    }})}};
  });
}

test('Google POI 조회는 저장하지 않고 리뷰는 명시적으로 요청하며 안전하게 표시한다',async({context,page})=>{
  await start(context,page);await googleMock(page);
  await page.evaluate(()=>onMapTap(35.6,139.7,'cafe'));
  await expect(page.locator('#placeDetailsTitle')).toHaveText('샘플 카페');
  await expect(page.locator('#placeDetailsContent')).toContainText('평가 42개');
  await expect(page.locator('#placeDetailsContent')).toContainText('09:00–18:00');
  expect(await page.evaluate(()=>trip().days[0].spots.length)).toBe(0);
  expect(await page.evaluate(()=>__fields.length)).toBe(1);
  await expect(page.locator('#placeDetails a[href^="javascript:"]')).toHaveCount(0);
  await page.getByRole('button',{name:'리뷰 보기',exact:true}).click();
  await expect(page.locator('.placeReview')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.evaluate(()=>__fields.length)).toBe(2);
  await page.getByRole('button',{name:'일정에 추가',exact:true}).click();
  await expect(page.locator('#spotName')).toHaveValue('샘플 카페');
  await expect(page.locator('#spotPlaceId')).toHaveValue('cafe');
  expect(await page.evaluate(()=>trip().days[0].spots.length)).toBe(0);
  await page.locator('#spotSave').click();
  expect(await page.evaluate(()=>trip().days[0].spots[0].placeId)).toBe('cafe');
  expect(await page.evaluate(()=>JSON.stringify(trip()).includes('평가 42'))).toBe(false);
  expect(await page.evaluate(()=>trip().days[0].spots[0].reviews)).toBeUndefined();
});

test('검색 상세를 닫으면 편집 입력과 포커스가 유지되고 선택해야 반영한다',async({context,page})=>{
  await start(context,page);await googleMock(page);
  await page.locator('.addSpot').first().click();
  await page.locator('#spotName').fill('작성 중인 이름');
  await page.evaluate(()=>{routedSearch=async()=>[{name:'샘플 카페',lat:35.6,lng:139.7,placeId:'cafe',city:'도쿄'}];});
  await page.locator('#spotSearch').fill('카페');await page.locator('#spotSearchBtn').click();
  await page.locator('.placeSearchResult').click();
  await expect(page.locator('#placeDetails')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#spotModalBg')).toBeVisible();
  await expect(page.locator('#spotName')).toHaveValue('작성 중인 이름');
  await expect(page.locator('.placeSearchResult')).toBeFocused();
  await page.locator('.placeSearchResult').click();
  await page.getByRole('button',{name:'이 장소 선택',exact:true}).click();
  await expect(page.locator('#spotName')).toHaveValue('샘플 카페');
});

test('국내는 제공된 기본 정보를 표시하고 읽기 전용에서도 조회만 가능하다',async({context,page})=>{
  await start(context,page);await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{viewMode=true;openPlaceDetails({name:'국내 카페',kakaoId:'123',addr:'서울 1번지',phone:'02-1234',category:'음식점 > 카페'});});
  await expect(page.locator('#placeDetailsContent')).toContainText('02-1234');
  await expect(page.locator('#placeDetailsContent')).toContainText('공개 API에서 제공하지');
  await expect(page.locator('#placeDetailsActions button')).toHaveCount(0);
  await expect(page.locator('#placeDetails a')).toHaveAttribute('href','https://place.map.kakao.com/123');
  expect(await page.locator('#placeDetails').evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBe(true);
});

test('늦은 응답이 새 장소를 덮어쓰지 않고 닫은 뒤에도 다시 열지 않는다',async({context,page})=>{
  await start(context,page);
  await page.evaluate(()=>{
    fetchPlaceDetails=s=>s.name==='느린 곳'?new Promise(resolve=>{window.__finish=()=>resolve({kind:'saved',name:'느린 곳'});}):Promise.resolve({kind:'saved',name:s.name});
    openPlaceDetails({name:'느린 곳'});openPlaceDetails({name:'새 장소'});
  });
  await expect(page.locator('#placeDetailsTitle')).toHaveText('새 장소');
  await page.evaluate(()=>__finish());
  await expect(page.locator('#placeDetailsTitle')).toHaveText('새 장소');
  await page.locator('#placeDetailsClose').click();
  await expect(page.locator('#placeDetails')).toBeHidden();
});

test('상세 실패 후 재시도하며 ID 없는 장소와 카카오 지도에서는 Google 상세를 추측하지 않는다',async({context,page})=>{
  await start(context,page);
  await page.evaluate(()=>{
    const original=fetchPlaceDetails;
    window.__tries=0;
    fetchPlaceDetails=async s=>{if(++window.__tries===1)throw Error('network');return original(s);};
    openPlaceDetails({name:'메모로 넣은 곳'});
  });
  await page.getByRole('button',{name:'다시 시도',exact:true}).click();
  await expect(page.locator('#placeDetailsContent')).toContainText('자동 연결하지 않습니다');
  await page.evaluate(()=>{engine='kakao';window.google={maps:{importLibrary:()=>{throw Error('호출 금지');}}};openPlaceDetails({name:'국내 Google 결과',placeId:'g'});});
  await expect(page.locator('#placeDetailsContent')).toContainText('자동 연결하지 않습니다');
});

test('기존 일정의 장소 정보는 편집과 분리되어 제공된다',async({context,page})=>{
  await start(context,page);
  await page.evaluate(()=>{trip().days[0].spots.push({name:'저장한 카페',kakaoId:'321',lat:37.5,lng:127});render();});
  await page.locator('.spot .actionMenu summary').first().click();
  await page.getByRole('button',{name:'장소 정보',exact:true}).click();
  await expect(page.locator('#placeDetailsTitle')).toHaveText('저장한 카페');
  await page.getByRole('button',{name:'일정 편집',exact:true}).click();
  await expect(page.locator('#spotName')).toHaveValue('저장한 카페');
});

test('저장된 카카오 ID와 다른 검색 결과는 상세정보에 연결하지 않는다',async({context,page})=>{
  await start(context,page);
  await page.evaluate(()=>{
    kakaoSearch=async()=>({list:[{name:'동명이인 매장',kakaoId:'wrong',phone:'02-0000',addr:'다른 주소'}]});
    openPlaceDetails({name:'내가 저장한 매장',kakaoId:'exact'});
  });
  await expect(page.locator('#placeDetailsContent')).toContainText('최신 정보를 찾지 못했어요');
  await expect(page.locator('#placeDetailsContent')).not.toContainText('02-0000');
});

test('가고 싶은 곳은 확인 폼으로 연결하고 기존 후보 초안을 덮어쓰지 않는다',async({context,page})=>{
  await start(context,page);
  await page.evaluate(()=>{
    sb={};user={id:'test'};renderCandidates=()=>{};
    openPlaceDetails({name:'카페',kakaoId:'123',addr:'서울',phone:''});
  });
  await page.getByRole('button',{name:'가고 싶은 곳에 담기',exact:true}).click();
  await expect(page.locator('#candTitleInput')).toHaveValue('카페');
  await expect(page.locator('#candNoteInput')).toHaveValue('https://place.map.kakao.com/123');
  await page.locator('#candTitleInput').fill('작성 중인 다른 후보');
  await page.evaluate(()=>openPlaceDetails({name:'새 후보',kakaoId:'456',addr:'서울',phone:''}));
  await page.getByRole('button',{name:'가고 싶은 곳에 담기',exact:true}).click();
  await expect(page.locator('#candTitleInput')).toHaveValue('작성 중인 다른 후보');
  expect(await page.evaluate(()=>trip().days[0].spots.length)).toBe(0);
});

test('상세 조회 중 바뀐 일정의 같은 인덱스를 다른 장소로 편집하지 않는다',async({context,page})=>{
  await start(context,page);
  await page.evaluate(()=>{
    trip().days[0].spots=[{name:'원래 장소'}];openSavedPlace(0,0);
    trip().days[0].spots=[{name:'다른 기기가 넣은 장소'}];
    window.__undos=0;undo=()=>{window.__undos++;};
  });
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>__undos)).toBe(0);
  await page.getByRole('button',{name:'일정 편집',exact:true}).click();
  await expect(page.locator('#placeDetails')).toBeHidden();
  await expect(page.locator('#spotModalBg')).not.toHaveClass(/show/);
});
