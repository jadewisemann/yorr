package com.ssafy.yorr.game.yacht;

public final class YachtDiceWsTypes {

    private static final String PREFIX = "game.yacht_dice.";

    private YachtDiceWsTypes() {
    }

    public static String type(String eventType) {
        return PREFIX + eventType;
    }
}
