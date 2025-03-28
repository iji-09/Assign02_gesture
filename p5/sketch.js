let port;  // 시리얼 포트 객체
let isConnected = false; // 아두이노 연결 상태
let selectedPort = null; // 선택된 포트 저장용
let portSelect;          // 포트 선택 UI -> 이걸 쓰나?

// 신호등 기본 시간 설정값 (ms 단위)
let redTime = 2000, yellowTime = 500, greenTime = 2000;
let brightness = 255; // 초기 밝기
let greenBlinkInterval = 166; // 초록불 깜빡임 간격

let currentLight = "red"; // 현재 신호등 상태
let mode = "normal"; // 현재 모드 (기본값 normal)

let isBlinking = false;   // 모든 LED 깜빡이는 상태 여부
let isRedOnly = false;    // 빨간불 전용 모드 여부
let isTraffic = true;     // 신호등 작동 중인지 여부
let isGreenBlink = false; // 초록불 깜빡이기 진행 중 여부

let blinkCount = 0; // 깜빡임 횟수
let lastChange = 0; // 마지막 상태 변경 시간
let ledOn = false;  // LED 켜진 상태

//ㅡㅡㅡㅡhandpose 관련 변수 선언ㅡㅡㅡㅡ
let handpose;   // handpose 모델
let video;      // 비디오 입력
let hands = []; // 검출된 손 정보

let activeSlider = null;  // 현재 제어 중인 슬라이더
let prevX = null;  // 이전 손의 X 위치
let isMiddleRing = false;
let isShaka = false;
let isPalmBack = false;
let gestureCooldown = 2000;  // 제스처 쿨타임 (ms)
let lastGestureTime = 0;    // 마지막 제스처 실행 시간


// setup: 처음 한 번 실행되는 함수
async function setup() {
    createCanvas(640, 1020);  // 캔버스 생성
    background(240);          // 배경 색상

    // --------- handpose + 웹캠 설정 ----------
    // 비디오 캡처 및 handpose 모델 로딩
    video = createCapture(VIDEO);
    video.size(640, 400);
    video.hide(); // 비디오를 캔버스에만 그리기 위해 숨김
    
    // handpose 모델 로딩 및 예측 결과 저장
    handpose = ml5.handpose(video, () => {
        console.log("Handpose model loaded");
    });
    
    handpose.on("predict", results => {
        hands = results;
    });

    //-------------슬라이더 생성---------------

    // 슬라이더 생성 위치
    let sliderX = 30;
    let sliderY = 280;

    // 밝기 조절 슬라이더 (0~255 범위, 초기값 255)
    brightnessSlider = createSlider(0, 255, 255);
    brightnessSlider.position(sliderX, sliderY);
    brightnessSlider.input(sendBrightnessData);


    // 시간 조절 슬라이더
    sliderY += 50;
    // 빨간불 시간 (1000~5000, 초기값 = redTime)
    redSlider = createSlider(1000, 5000, redTime);
    redSlider.position(sliderX, sliderY);

    sliderY += 50;
    // 노란불 시간 (200~2000, 초기값 = yellowTime)
    yellowSlider = createSlider(200, 2000, yellowTime);
    yellowSlider.position(sliderX, sliderY);

    sliderY += 50;
    // 초록불 시간 (1000~5000, 초기값 = greenTime)
    greenSlider = createSlider(1000, 5000, greenTime);
    greenSlider.position(sliderX, sliderY);

    // 슬라이더가 움직일 때마다 아두이노에 주기 전송
    redSlider.input(() => {
        sendTimingData();
        sendBrightnessData(); // 기존 밝기 전송도 유지
    });
    yellowSlider.input(sendTimingData);
    greenSlider.input(sendTimingData);

    //-------------------UI 버튼 요소 생성---------------------
    
    lastChange = millis();

    let connectButton = createButton("아두이노 연결/해제");
    connectButton.position(30, 30);
    connectButton.mousePressed(() => connectBtnClick(portSelect));

    let redButton = createButton("BUTTON 1: red only");
    redButton.position(300, 250);
    redButton.mousePressed(toggleRedOnly);

    let blinkButton = createButton("BUTTON 2: all blink");
    blinkButton.position(300, 325);
    blinkButton.mousePressed(toggleBlinking);

    let trafficButton = createButton("BUTTON 3: traffic light");
    trafficButton.position(300, 400);
    trafficButton.mousePressed(toggleTraffic);
}


// 아두이노 연결 버튼 클릭 시 실행
async function connectBtnClick(portSelect) {
    if (!isConnected) {
        try {
            selectedPort = await navigator.serial.requestPort(); // 포트 선택 창 표시
            await selectedPort.open({ baudRate: 9600 }); // 선택한 포트를 9600 보레이트로 열기 (아두이노 기본 통신속도)
            port = selectedPort; // 전역 변수 port에 연결된 포트 정보 저장
            isConnected = true; // 연결 상태를 true로 설정
            console.log("Connect Arduino"); // 연결 완료 로그 출력
            readSerialData(); // 데이터 수신 시작
        } 
        catch (error) {
            console.error("serial error:", error); // 연결 실패 시 콘솔에 에러 메시지 출력
        }
    } 
    else {
        await port.close();  // 연결된 포트를 닫음
        isConnected = false; // 연결 상태 false로 변경
        console.log("Arduino connecting canceled"); // 연결 해제 로그 출력
    }
}

// 시리얼 데이터 수신
let serialBuffer = "";
async function readSerialData() { // 시리얼 데이터를 비동기적으로 계속 읽기 위한 함수
    while (port.readable && isConnected) { // 포트를 읽을 수 있고 연결 되어있을 때만 작동
        const reader = port.readable.getReader(); // 포트로부터 데이터를 읽기 위해 reader 객체 생성
        try {
            while (true) { // 연결이 끊기기 전까지는 계속 실행 됨(무한루프)
                const { value, done } = await reader.read();
                if (done) break;
                // 데이터를 읽고 done이 true이면 종료(더이상 읽을 데이터가 X)
                let decoder = new TextDecoder("utf-8");
                let chunk = decoder.decode(value, { stream: true });
                serialBuffer += chunk;
                // 문자열을 읽어와서 기존 버퍼에 덧붙임

                let lines = serialBuffer.split("\n"); // 문자열을 나누어 한줄씩 처리되도록 설정
                for (let i = 0; i < lines.length - 1; i++) { // 마지막 줄은 아직 문자열을 덜 받았을 수도 있기 때문에 -1해서 처리
                    updateTrafficState(lines[i].trim()); // trim으로 앞뒤 공백을 제거하고 함수에 전달
                }
                serialBuffer = lines[lines.length - 1]; // 덜 받은 문자열은 다시 저장해서 다음 read 할 때 사용
            }
        } catch (error) {
            console.error("data error:", error);
        } finally {
            reader.releaseLock();
        } // read가 끝나면 releaseLock을 이용해서 리더를 해제하고 다음 읽기를 동작해야함
    }
}


// 신호등 상태 업데이트
function updateTrafficState(data) {
    if (data === "RED") currentLight = "red";
    else if (data === "YELLOW") currentLight = "yellow";
    else if (data === "GREEN") currentLight = "green";
    else if (data === "GREENBLINK") currentLight = "greenBlink";
    else if (data === "YELLOW2") currentLight = "yellow2";

    if (data.startsWith("BRIGHTNESS:")) {
        let newBrightness = parseInt(data.split(":")[1].trim(), 10);
        brightnessSlider.value(newBrightness); // 슬라이더 값 업데이트
        brightness = newBrightness; // 내부 변수도 업데이트
    }
    
    
    // 버튼 상태 업데이트 (아두이노에서 버튼이 눌렸을 때)
    else if (data === "BUTTON1_ON") {
        isRedOnly = true;
        isTraffic = false;
        isBlinking = false;
        mode = "red-only"; 
        currentLight = "red";
        console.log("Arduino B1 On");
    } 
    else if (data === "BUTTON1_OFF") {
        isRedOnly = false;
        isTraffic = true;
        mode = "normal";
        console.log("Arduino B1 Off");
    }

    else if (data === "BUTTON2_ON") {
        isBlinking = true;
        isRedOnly = false;
        isTraffic = false;
        mode = "blinking";
        console.log("Arduino B2 On");
    }
    else if (data === "BUTTON2_OFF") {
        isBlinking = false;
        isTraffic = true;
        stopAll();
        mode = "normal";
        console.log("Arduino B2 Off");
    }

    else if (data === "BUTTON3_ON") {
        stopAll();
        isTraffic = true;
        mode = "normal";
        console.log("Arduino B3 On");
    }
    else if (data === "BUTTON3_OFF") {
        stopAll();
        console.log("Arduino B3 Off");
    }
}

// 밝기조절 전송 함수
function sendBrightnessData() {
    if (port && port.writable) {
        let brightnessValue = brightnessSlider.value();
        sendSerialData("BRIGHTNESS_SET:" + brightnessValue);
        console.log("p5 → Arduino: BRIGHTNESS_SET:", brightnessValue);
    }
}


// 시리얼 데이터 전송 함수
async function sendSerialData(data) {
    if (port && port.writable) {
        const writer = port.writable.getWriter();
        await writer.write(new TextEncoder().encode(data + "\n"));
        writer.releaseLock();
    }
}

//---------------------------------//
//          버튼 기능 구현          //
//---------------------------------//


// 모든 기능 OFF
function stopAll() {    
    isBlinking = false;
    isRedOnly = false;
    isTraffic = false;
    // 모드를 "stopped"로 바꿔서 어떤 기능도 없는 상태로 만듦
    mode = "stopped";
    
    // 화면 표시를 위해 lastChange를 초기화
    lastChange = millis();
}


//------------------BUTTON 1: RED LED ON/OFF----------------------
function toggleRedOnly() {

    // 빨간 LED만 켜진 상태가 아니라면(신호등이거나 깜빡이거나)
    if (mode !== "red-only") { 
        stopAll();  // 모든 기능 종료
        // 빨간불 전용 모드 ON
        sendSerialData("r");
        isRedOnly = true; 
        mode = "red-only";
        currentLight = "red";  
        console.log("p5 / Red Led only ON");
    } 
    // 빨간 LED만 켜져있는 상태라면
    else if(mode === "red-only") {
        mode = !mode;
        stopAll();  // 모든 기능 종료

        sendSerialData("1");
        isTraffic = true;
        mode = "normal";
        console.log("p5 / Red Led only OFF");
        
    }
}
    

// -------------------BUTTON 2: ALL LED BLINKING-------------------
function toggleBlinking() {

    // 모든 LED가 깜빡이는 상태가 아니라면(신호등이거나 빨간불 only라면)
    if (mode !== "blinking") {
        stopAll(); // 모든 기능 종료

        isBlinking = true; // BUTTON 2 활성화
        mode = "blinking"; // blinking으로 모드 변경
        sendSerialData("b"); // 모든 LED 깜빡이기 시작
        
        lastChange = millis(); 
        ledOn = false;
        console.log("p5 / All Led Blink ON");
    } 

    // 모든 LED가 깜빡이는 상태라면 
    else { 
        stopAll(); // 모든 기능 종료
        sendSerialData("1"); // 모든 LED 깜빡이기 중지

        // 버튼2일 때 버튼 1누르면
        if(isRedOnly) { 
            sendSerialData("r"); // 버튼1 다시 시작
            mode = "red-only"; // red-only 모드로 변경
            isRedOnly = true; // BUTTON 1 활성화
            console.log("p5 / all Led Blink OFF & Red Led only ON");
        }
        // 버튼2일 때 버튼 3누르면
        else if(isTraffic) { 
            sendSerialData("1"); // 신호등 기능 다시 시작
            mode = "normal"; // normal 모드로 변경
            isTraffic = true; // BUTTON 3 활성화
            console.log("p5 / all Led Blink OFF & Traffic ON");
        }
        // 버튼2일 때 버튼 2 다시 누르면
        else {
            currentLight = "red";     // 빨간불부터
            lastChange = millis();    // 시간을 초기화

            sendSerialData("1"); // 신호등 기능 다시 시작
            mode = "normal"; // normal 모드로 변경
            isTraffic = true; // BUTTON 3 활성화
            console.log("p5 / all Led Blink OFF");
        }
    }
}

// 모든 LED 깜빡이기 (버튼 2의 기능)
function blinkAllLEDs() {
    let now = millis();

    // 버튼2가 동작 중이면서 500ms가 지났으면
    if (isBlinking && now - lastChange >= 500) { // 500ms 간격으로 깜빡이기
        ledOn = !ledOn; // 반전
        lastChange = now; // 시간 초기화
    }
    let activeAlpha = brightness;      // 슬라이더 값 0~255
    let inactiveAlpha = brightness * 0 // 혹은 brightness * 0.3 등

    
    stroke(0); 
    if (ledOn) {
        // 빨강
        fill(255, 0, 0, activeAlpha);
        ellipse(150, 100, 60, 60);

        // 노랑
        fill(255, 255, 0, activeAlpha);
        ellipse(250, 100, 60, 60);

        // 초록
        fill(0, 255, 0, activeAlpha);
        ellipse(350, 100, 60, 60);
    } else {
        // LED를 끌 때도 brightness(=0) 혹은 회색 표시
        fill(240, inactiveAlpha); 
        ellipse(150, 100, 60, 60);
        ellipse(250, 100, 60, 60);
        ellipse(350, 100, 60, 60);
    }
}


//------------------BUTTON 3: TRAFFIC LIGHT ON/OFF----------------------
function toggleTraffic() {

    // 신호등 기능이 꺼진 상태라면(red only거나 모든 LED 깜빡이기 중이라면)
    if (mode !== "normal") {
        stopAll(); // 모든 기능 종료

        currentLight = "red";     // 빨간불부터
        lastChange = millis();    // 시간을 초기화

        sendSerialData("1"); // 신호등 기능 시작
        mode = "normal"; // normal 모드로 변경
        isTraffic = true; // 신호등 기능 활성화
        console.log("p5 / Traffic ON");
    } 
    // 신호등 기능이 켜진 상태라면
    else {
        stopAll(); // 모든 기능 종료(p5)
        sendSerialData("0");  // 신호등 기능 중지(아두이노)
        mode = "stopped";
        console.log("p5 / Traffic OFF");
    }
}


// ---------------------------- //
//          p5.js UI            //
// ---------------------------- //

function draw() {
    background(240);


    // --- 좌우 반전된 카메라 영상 출력 ---
    push();
    translate(video.width, 0);
    scale(-1, 1);  // 좌우 반전
    image(video, 0, 550, 640, 500);  // 명확한 크기 고정

    pop();

    drawHandKeypoints(); // 손 키포인트 그리기

    // 신호등 로직 수행
    brightness = brightnessSlider.value();
    redTime = redSlider.value();
    yellowTime = yellowSlider.value();
    greenTime = greenSlider.value();

    if (!isBlinking) {
        drawTrafficLights();
    }
    
    fill(0);
    textSize(16);

    let textX = 30, textY = 270;
    text(`밝기: ${brightness}`, textX, textY);
    textY += 50;
    text(`빨간불: ${redTime}ms`, textX, textY);
    textY += 50;
    text(`노란불: ${yellowTime}ms`, textX, textY);
    textY += 50;
    text(`초록불: ${greenTime}ms`, textX, textY);

    textSize(20);
    fill(50);
    text(`현재 모드: ${mode}`, 30, 500);
    text(`현재 신호등: ${currentLight.toUpperCase()}`, 30, 530);

    if (isTraffic) { // 신호등이 작동 중일 때만 실행
        updateTrafficLight();
    } else if (isBlinking) { // 모든 LED 깜빡이기 모드일 때
        blinkAllLEDs();
    }

    detectGestureAndControlSlider();

} // draw의 끝

//----------------손 키포인트 그리는 기능----------------
function drawHandKeypoints() {
    
    for (let i = 0; i < hands.length; i++) {
        let hand = hands[i];
        let keypoints = hand.landmarks;

        for (let j = 0; j < keypoints.length; j++) {
            let [x, y] = keypoints[j];
            fill(255, 0, 0);
            noStroke();
            
            let flippedX = width - x; // ← 좌우 반전
            circle(flippedX, y + 560, 10);
        }
    }
}


//----------------신호등 UI 표시-------------------
function drawTrafficLights() {
    let lightX = [150, 250, 350];

    // 모든 기능이 꺼진 상태일 때
    if (mode === "stopped") {
        fill(240); // 회색
        for (let i = 0; i < 3; i++) {
            stroke(0);
            ellipse(lightX[i], 100, 60, 60);
        }
        return; // 함수 종료
    }
    
    // 활성화 / 비활성화 밝기를 결정
    let activeAlpha = brightness;        // 켜진 상태일 때 알파 (0~255)
    let inactiveAlpha = brightness * 0   // 꺼진 상태일 때 알파 
    

    // 빨강
    stroke(0);
    if (currentLight === "red") {
        fill(255, 0, 0, activeAlpha);
    } else {
        fill(255, 0, 0, inactiveAlpha);
    }
    ellipse(lightX[0], 100, 60, 60);

    // 노랑 or 노랑2
    stroke(0);
    if (currentLight === "yellow" || currentLight === "yellow2") {
        fill(255, 255, 0, activeAlpha);
    } else {
        fill(255, 255, 0, inactiveAlpha);
    }
    ellipse(lightX[1], 100, 60, 60);

    // 초록 (깜빡이기 중이면 켜진 상태로 볼 수도 있음)
    stroke(0);
    if (currentLight === "green" || (currentLight === "greenBlink" && isGreenBlink)) {
        fill(0, 255, 0, activeAlpha);
    } else {
        fill(0, 255, 0, inactiveAlpha);
    }
    ellipse(lightX[2], 100, 60, 60);

}


// ㅡㅡㅡㅡㅡㅡㅡ제스처 감지 함수ㅡㅡㅡㅡㅡㅡㅡ
function detectGestureAndControlSlider() {
    if (hands.length === 0) return;
    // 손이 화면에 안 보이면 함수 종료 (더 이상 아무것도 하지 않음)

    let hand = hands[0];
    let landmarks = hand.landmarks; // 첫 번째 손을 가져와서 랜드마크 배열을 landmarks에 저장
    let now = millis(); // 현재 시간을 now에 저장 (제스처 쿨타임 확인용)


    // ===== 제스처 상태 변수 초기화 =====
    let isFist = true; // 주먹(red slider)
    let isPeace = false; // 브이(yellow slider)
    let isHandOpen = false; // 보자기(green slider)

    let isShaka = false; // red only button
    let isIndexOnly = false; // all blink button
    let isOKSign = false; // traffic on/off button


    // ✊ 주먹: 모든 손가락 접혀 있음
    for (let i = 8; i <= 20; i += 4) {
        if (landmarks[i][1] < landmarks[i - 2][1]) {
            isFist = false;
        } // 손가락 5개가 모두 접혀 있어야 isFist = true
    }

    // ✌️ 브이: 2번(검지), 6번(중지) 펴짐 & 나머지 접힘
    let indexUp = landmarks[8][1] < landmarks[6][1];     // 검지 펴짐
    let middleUp = landmarks[12][1] < landmarks[10][1];  // 중지 펴짐
    let ringDown = landmarks[16][1] > landmarks[14][1];  // 약지 접힘
    let pinkyDown = landmarks[20][1] > landmarks[18][1]; // 새끼 접힘
    if (indexUp && middleUp && ringDown && pinkyDown) isPeace = true;


    // 🖐 손바닥 펴짐: 모든 손가락이 펴져 있음
    let allFingersUp = true;
    for (let i = 8; i <= 20; i += 4) {
        if (landmarks[i][1] > landmarks[i - 2][1]) {
            allFingersUp = false;
        } //손가락 끝이 중간마디보다 위에 있으면 손가락이 펴진 것으로 인식
    }
    if (allFingersUp) isHandOpen = true; // 모든 손가락이 펴졌을 경우 isHandOpen = true

    // 🤙 샤카: 엄지, 새끼손가락만 펼침
    let thumbUp = landmarks[4][0] < landmarks[3][0];  // 엄지 오른쪽으로 펼침
    let pinkyUp = landmarks[20][1] < landmarks[18][1];
    let indexDown = landmarks[8][1] > landmarks[6][1];
    let middleDown = landmarks[12][1] > landmarks[10][1];
    let ringDown2 = landmarks[16][1] > landmarks[14][1];
    if (thumbUp && pinkyUp && indexDown && middleDown && ringDown2) isShaka = true;


    // 👆 검지만 펴짐
    let indexOnly = indexUp &&
                    landmarks[12][1] > landmarks[10][1] &&
                    landmarks[16][1] > landmarks[14][1] &&
                    landmarks[20][1] > landmarks[18][1];
    if (indexOnly) isIndexOnly = true; // 검지만 펴지고 나머지는 접혔다면 true

    // 👌 오케이 포즈
    let distThumbIndex = dist(landmarks[4][0], landmarks[4][1], landmarks[8][0], landmarks[8][1]);
    let middleUpOK = landmarks[12][1] < landmarks[10][1];
    let ringUpOK   = landmarks[16][1] < landmarks[14][1];
    let pinkyUpOK  = landmarks[20][1] < landmarks[18][1];
    if (distThumbIndex < 40 && middleUpOK && ringUpOK && pinkyUpOK) isOKSign = true;
    // 엄지와 검지 끝이 가까우면서 나머지 손가락이 펴져 있으면 OK 사인


    // 제스처에 따라 슬라이더 선택
    if (isFist) {
        activeSlider = redSlider;
    } else if (isPeace) {
        activeSlider = yellowSlider;
    } else if (isHandOpen) {
        activeSlider = greenSlider;
    } else {
        activeSlider = null;
    }

    // 손 움직임에 따라 슬라이더 조절(손 움직임으로 좌우 슬라이딩)
    let palmX = width - landmarks[0][0];  // 좌우 반전 적용
    if (prevX !== null && activeSlider) {
        let dx = palmX - prevX;             // 이전 X 위치와 비교
        if (abs(dx) > 5) {                  // 너무 작으면 무시
            let val = activeSlider.value();
            if (dx > 0) val += 100;         // 오른쪽 → 증가
            else val -= 100;                // 왼쪽 → 감소
            val = constrain(val, activeSlider.elt.min, activeSlider.elt.max);
            activeSlider.value(val);
            sendTimingData(); // 값 변경 시 아두이노에 전송
        }
    }

    prevX = palmX; // 현재 위치 저장


    // 버튼 제어 (쿨타임 적용)
    if (now - lastGestureTime > gestureCooldown) {
        if (isShaka) {
            toggleRedOnly();
            lastGestureTime = now;
        } else if (isIndexOnly) {
            toggleBlinking();
            lastGestureTime = now;
        } else if (isOKSign) {
            toggleTraffic();
            lastGestureTime = now;
        }
    }

}

//----------------기본 신호등 기능------------------
function updateTrafficLight() {
    let now = millis();

    if (currentLight === "red" && now - lastChange >= redTime) {
        currentLight = "yellow";  // 첫 번째 노랑
        lastChange = now;
    } 
    else if (currentLight === "yellow" && now - lastChange >= yellowTime) {
        currentLight = "green";
        lastChange = now;
    } 
    else if (currentLight === "green" && now - lastChange >= greenTime) {
        currentLight = "greenBlink";
        isGreenBlink = true;
        blinkCount = 0;
        lastChange = now;
    } 
    else if (currentLight === "greenBlink" && now - lastChange >= greenBlinkInterval) {
        blinkCount++;
        lastChange = now;
        
        if (blinkCount >= 7) { // 6번 깜빡이면 종료
            currentLight = "yellow2";
            isGreenBlink = false;
            lastChange = now;
        }
        else {
            isGreenBlink = !isGreenBlink;
        }
    }
    else if (currentLight === "yellow2" && now - lastChange >= yellowTime) {
        currentLight = "red";
        lastChange = now;
    } 
}

// 아두이노에서의 주기 조절을 위한 함수
function sendTimingData() {
    if (port && port.writable) {
      let redVal = redSlider.value();
      let yellowVal = yellowSlider.value();
      let greenVal = greenSlider.value();
  
      sendSerialData(`TIMING:RED=${redVal},YELLOW=${yellowVal},GREEN=${greenVal}`);
      console.log(`p5 → Arduino: TIMING:RED=${redVal},YELLOW=${yellowVal},GREEN=${greenVal}`);
    }
}
  