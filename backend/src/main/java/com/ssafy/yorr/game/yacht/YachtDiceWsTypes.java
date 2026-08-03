package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.module.GameWsTypes;

public final class YachtDiceWsTypes {

    private YachtDiceWsTypes() {
    }

    public static String type(String eventType) {
        return GameWsTypes.type(YachtDiceGameModule.CODE, eventType);
    }
}
