import XCTest

final class ReviewFlowsUITests: XCTestCase {
    private func launch(_ extras: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--ios-review-ui", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"] + extras
        app.launch()
        return app
    }
    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    private func replace(_ field: XCUIElement, with text: String) {
        field.tap()
        let old = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + text)
    }

    func testInvalidPasteDateBlocksCreationUntilCorrected() {
        let app = launch(["--review-paste", "--review-reset-draft"])
        let input = app.textViews["pasteItineraryText"]
        XCTAssertTrue(input.waitForExistence(timeout: 10)); input.tap(); input.typeText("12.50 EUR itinerary")
        app.buttons["읽어 보기"].tap()
        let start = app.textFields["시작일 직접 입력"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        replace(start, with: "2026-99-99")
        XCTAssertFalse(app.buttons["pasteItineraryCreate"].isEnabled)
        screenshot(app, "paste-invalid-date-blocked")
        replace(start, with: "2026-10-14")
        XCTAssertTrue(app.buttons["pasteItineraryCreate"].isEnabled)
        app.buttons["pasteItineraryCreate"].tap()
        XCTAssertTrue(app.staticTexts["reviewSavedPaste"].waitForExistence(timeout: 5))
    }

    func testNewTripInputsFreezeWhileCreationWaits() {
        let app = launch(["--review-followup", "--review-scratch"])
        let name = app.textFields["newTripName"]
        XCTAssertTrue(name.waitForExistence(timeout: 10)); name.tap(); name.typeText("지연 생성 여행")
        app.buttons["newTripCreate"].tap()
        XCTAssertFalse(name.isEnabled)
        XCTAssertFalse(app.textFields["newTripCity"].isEnabled)
        screenshot(app, "new-trip-inputs-locked")
        let saved = app.staticTexts["reviewFollowupSaved"]
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        XCTAssertEqual(saved.label, "지연 생성 여행")
    }

    func testPricedHotelExpenseCreatesSeparateCostAndPreservesBooking() {
        let app = launch(["--review-followup"])
        let hotel = app.buttons["spotExpenseChoice-0"]
        XCTAssertTrue(hotel.waitForExistence(timeout: 10)); hotel.tap()
        let amount = app.textFields["quickSpendAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5)); amount.tap(); amount.typeText("50")
        XCTAssertEqual(app.textFields["quickSpendTitle"].value as? String, "합성 호텔 별도 비용")
        app.buttons["quickSpendCurrency"].tap(); app.buttons["EUR"].tap()
        app.buttons["quickSpendSave"].tap()
        let saved = app.staticTexts["reviewFollowupSaved"]
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertTrue(saved.label.contains("별도 비용 50.0 EUR"))
        XCTAssertTrue(saved.label.contains("예약 200.0 EUR"))
        screenshot(app, "hotel-separate-cost-saved")
    }

    func testSharedInputFreezesAcrossDelayedReadAndWrite() {
        let app = launch(["--review-followup", "--review-shared"])
        let save = app.buttons["sharedImportSave"]
        XCTAssertTrue(save.waitForExistence(timeout: 10))
        let ready = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: save)
        wait(for: [ready], timeout: 10)
        save.tap()
        XCTAssertFalse(app.textFields["sharedImportTitle"].isEnabled)
        XCTAssertFalse(app.textViews["sharedImportText"].isEnabled)
        screenshot(app, "shared-inputs-locked")
        XCTAssertTrue(app.staticTexts["저장했어요"].waitForExistence(timeout: 15))
        screenshot(app, "shared-input-saved")
    }

    func testPasteDraftSurvivesTerminationAndKeepsForeignAmountOnCreate() {
        let app = launch(["--review-paste", "--review-reset-draft"])
        let text = app.textViews["pasteItineraryText"]
        XCTAssertTrue(text.waitForExistence(timeout: 10)); text.tap(); text.typeText("12.50 EUR itinerary")
        app.terminate()
        app.launchArguments.removeAll { $0 == "--review-reset-draft" }; app.launch()
        XCTAssertTrue(app.buttons["restorePasteDraft"].waitForExistence(timeout: 10))
        app.buttons["restorePasteDraft"].tap()
        XCTAssertEqual(app.textViews["pasteItineraryText"].value as? String, "12.50 EUR itinerary")
        screenshot(app, "paste-draft-restored")
        app.buttons["읽어 보기"].tap()
        let create = app.buttons["pasteItineraryCreate"]
        XCTAssertTrue(create.waitForExistence(timeout: 5)); create.tap()
        XCTAssertTrue(app.staticTexts["reviewSavedPaste"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["reviewSavedPaste"].label.contains("12.5"))
        screenshot(app, "paste-foreign-amount-saved")
    }

    func testForeignSearchKeepsSelectionOnSaveFailureAndClosesAfterRetry() {
        let app = launch(["--review-search"])
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.segmentedControls.buttons["해외"].isSelected)
        app.searchFields.firstMatch.tap(); app.searchFields.firstMatch.typeText("Paris\n")
        let result = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "에펠탑")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5)); result.tap()
        let addButton = app.buttons["placeAddConfirm"]
        XCTAssertTrue(addButton.waitForExistence(timeout: 5)); addButton.tap()
        XCTAssertTrue(app.staticTexts["placeAddError"].waitForExistence(timeout: 5))
        XCTAssertTrue(addButton.exists)
        screenshot(app, "search-failure-retained")
        addButton.tap()
        XCTAssertTrue(app.staticTexts["reviewSavedPlace"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["reviewSavedPlace"].label.contains("에펠탑"))
        XCTAssertFalse(app.buttons["placeAddConfirm"].exists)
    }

    func testUnknownFilterAndBudgetSaveWithKeyboard() {
        let app = launch()
        let unknown = app.buttons["reviewUnknownCosts"]
        XCTAssertTrue(unknown.waitForExistence(timeout: 10)); unknown.tap()
        XCTAssertTrue(app.otherElements["unconfirmedCostsFilter"].exists || app.staticTexts["미정·일부 금액만 보기"].exists)
        app.buttons["전체 보기"].tap()
        app.buttons["editTripBudget"].tap()
        let amount = app.textFields["costEntryAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5)); amount.tap()
        amount.press(forDuration: 1.2)
        if app.menuItems["전체 선택"].waitForExistence(timeout: 2) { app.menuItems["전체 선택"].tap() }
        else {
            let existing = amount.value as? String ?? ""
            amount.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
        }
        amount.typeText("900000")
        let save = app.buttons["costEntrySave"]
        XCTAssertTrue(save.isHittable); save.tap()
        XCTAssertTrue(app.buttons["editTripBudget"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["costEntryAmount"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "362,500")).firstMatch.waitForExistence(timeout: 5))
        screenshot(app, "cost-budget-saved")
    }

    func testCostDraftSurvivesProcessTerminationAndRequiresExplicitRestore() {
        let app = launch(["--review-draft", "--review-reset-draft"])
        let amount = app.textFields["costEntryAmount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 10)); amount.tap(); amount.typeText("1234")
        XCTAssertEqual(amount.value as? String, "1234")
        app.terminate()
        app.launchArguments.removeAll { $0 == "--review-reset-draft" }; app.launch()
        XCTAssertTrue(app.buttons["restoreCostDraft"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["costEntrySave"].isEnabled)
        app.buttons["restoreCostDraft"].tap()
        XCTAssertEqual(app.textFields["costEntryAmount"].value as? String, "1234")
        screenshot(app, "cost-draft-restored")
        app.buttons["costEntrySave"].tap()
    }

    func testBookingDraftSurvivesProcessTerminationAndSavesAfterRestore() {
        let app = launch(["--review-booking", "--review-reset-draft"])
        let title = app.textFields["bookingEntryTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 10)); title.tap(); title.typeText(" 복구")
        let edited = title.value as? String
        XCTAssertTrue(edited?.contains("복구") == true)
        app.terminate()
        app.launchArguments.removeAll { $0 == "--review-reset-draft" }; app.launch()
        XCTAssertTrue(app.buttons["restoreBookingDraft"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["bookingEntrySave"].isEnabled)
        app.buttons["restoreBookingDraft"].tap()
        XCTAssertEqual(app.textFields["bookingEntryTitle"].value as? String, edited)
        screenshot(app, "booking-draft-restored")
        app.buttons["bookingEntrySave"].tap()
        XCTAssertTrue(app.staticTexts["reviewSavedBooking"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["reviewSavedBooking"].label, edited)
    }

    func testLargeTextAndDarkCostsKeepMainActionsReachable() {
        let app = launch(["--review-large", "--review-dark"])
        XCTAssertTrue(app.buttons["reviewUnknownCosts"].waitForExistence(timeout: 10))
        for _ in 0..<4 where !app.buttons["editTripBudget"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.buttons["editTripBudget"].isHittable)
        screenshot(app, "cost-large-text-dark")
        app.buttons["editTripBudget"].tap()
        XCTAssertTrue(app.buttons["costEntrySave"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["costEntrySave"].isHittable)
    }

    func testRestoringChangedStayLinkPreservesManuallyEnteredCurrency() {
        let app = launch(["--review-booking", "--review-linked-draft"])
        XCTAssertTrue(app.buttons["restoreBookingDraft"].waitForExistence(timeout: 10))
        app.buttons["restoreBookingDraft"].tap()
        let amount = app.textFields["bookingEntryAmount"]
        for _ in 0..<4 where !amount.isHittable { app.swipeUp() }
        XCTAssertTrue(amount.isHittable)
        XCTAssertEqual(amount.value as? String, "17")
        let currency = app.buttons["bookingEntryCurrency"]
        XCTAssertTrue(currency.exists)
        XCTAssertTrue(currency.label.contains("USD") || (currency.value as? String) == "USD")
        screenshot(app, "booking-linked-draft-currency")
        app.buttons["bookingEntrySave"].tap()
        XCTAssertTrue(app.staticTexts["reviewSavedBooking"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["reviewSavedBooking"].label.contains("연결 복구"))
    }
}
