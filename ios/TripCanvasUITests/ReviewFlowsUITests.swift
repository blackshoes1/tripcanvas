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
