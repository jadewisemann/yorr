// ⚠️ 전환 중 — 이 파이프라인은 **backend-java(구 운영)와 프론트 Vercel 배포**만
//    담당한다. Node 백엔드(`backend/**`)의 CI/CD는 GitHub Actions로 옮겼다:
//    `.github/workflows/backend.yml` (결정: backend/docs/adr/0006-github-actions-ghcr-arm64-single-host.md).
//
//    이 파일을 아직 지우지 않은 이유는 두 가지다:
//      1. 전환이 끝나기 전까지 SSAFY 호스트의 backend-java가 운영이자 롤백
//         대상이다. Node 쪽에 문제가 생겼을 때 되돌아갈 길을 먼저 끊지 않는다.
//      2. 마지막 두 스테이지(Validate Frontend · Deploy Frontend to Vercel)는
//         백엔드 전환과 무관한데 같은 파일에 얽혀 있다. 지우면 **프론트 배포가
//         조용히 멈춘다.**
//
//    삭제 시점: PLANS.md Phase 5의 마지막 항목(backend-java 제거, 별도 PR).
//    그 전에 프론트 배포를 GitHub Actions나 Vercel Git 연동으로 옮겨야 한다.
//
//    이번 변경에서 백엔드 스테이지 5개를 `DEPLOY_LEGACY_BACKEND`(기본 false)로
//    잠갔고, 트리거에서 `deploy/**`·`Jenkinsfile`을 뺐다. 이유:
//      - backend-java는 동결이라(backend/AGENTS.md) 배포할 변경이 없다. 이미 떠 있는
//        컨테이너는 그대로 돌고, 이 잡이 다시 배포하지 않는다.
//      - `deploy/compose.yaml`은 이제 **Node/OCI 스택**이다. 외부 `app-network`를
//        전제하지 않고 `PUBLIC_HOST`를 요구하므로, 그 파일로 backend-java를 배포하면
//        `compose config`에서 즉시 실패한다. 트리거를 남겨 두면 Node 스택 파일을
//        고칠 때마다 이 잡이 빨간불이 된다.
//      - 프론트 스테이지는 그대로다(`frontend/**`·`Jenkinsfile` 트리거 유지).
//
//    ⚠️ backend-java로 되돌려야 하면 `DEPLOY_LEGACY_BACKEND`를 켜기 **전에** git
//       이력에서 구 `deploy/compose.yaml`을 되살려라. 다만 진짜 롤백은 재배포가
//       아니라 "프론트·DNS를 새 호스트로 옮기지 않는 것"이다 — 구 호스트의 Java
//       컨테이너는 계속 떠 있다.
pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
    }

    parameters {
        booleanParam(
            name: 'FORCE_DEPLOY_ALL',
            defaultValue: false,
            description: '변경 경로와 관계없이 백엔드와 프론트를 모두 배포'
        )

        // 전환 중 기본값 false — 파일 맨 위 주석 참고.
        // backend-java는 동결이므로 배포할 변경이 없고, `deploy/compose.yaml`은
        // 이제 Node/OCI 스택을 기술한다(외부 app-network를 전제하지 않고
        // PUBLIC_HOST를 요구한다). 즉 이 파이프라인의 백엔드 스테이지는 켜면
        // 실패한다. 켜기 전에 git 이력에서 구 compose.yaml을 되살려야 한다.
        booleanParam(
            name: 'DEPLOY_LEGACY_BACKEND',
            defaultValue: false,
            description: 'backend-java(구 운영)를 이 호스트에 재배포 — ' +
                '구 deploy/compose.yaml 복원이 선행돼야 한다'
        )
    }

    triggers {
        // webhook 연동 없이 SCM polling으로 변경 감지
        pollSCM('H/2 * * * *')
    }

    environment {
        VITE_API_BASE_URL = '/api/v1'
        VITE_WS_URL = 'ws://localhost:8080/ws/v1/game'
        VITE_ENABLE_MSW = 'true'
    }

    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                checkout scm

                sh '''
                    set -eu

                    echo "Branch: $BRANCH_NAME"
                    echo "Commit:"
                    git log -1 --oneline
                '''
            }
        }

        stage('Configure Environment') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'main') {
                        env.DEPLOY_ENV = 'main'
                        env.BACKEND_IMAGE = 'backend:prod'
                        env.BACKEND_CONTAINER =
                            'yorr-backend-main'
                        env.BACKEND_ENV_FILE =
                            '/infra/app/.env.main'
                        env.BACKEND_NETWORK =
                            'app-main-network'
                        env.BACKEND_ALIAS =
                            'backend-main'
                        env.COMPOSE_PROJECT =
                            'yorr-main'
                        env.VERCEL_PROJECT_CREDENTIAL =
                            'vercel-prod-project-id'
                        env.FRONTEND_ENV_CREDENTIAL =
                            'frontend-main'
                    } else if (env.BRANCH_NAME == 'develop') {
                        env.DEPLOY_ENV = 'dev'
                        env.BACKEND_IMAGE = 'backend:dev'
                        env.BACKEND_CONTAINER =
                            'yorr-backend-dev'
                        env.BACKEND_ENV_FILE =
                            '/infra/app/.env.dev'
                        env.BACKEND_NETWORK =
                            'app-dev-network'
                        env.BACKEND_ALIAS =
                            'backend-dev'
                        env.COMPOSE_PROJECT =
                            'yorr-dev'
                        env.VERCEL_PROJECT_CREDENTIAL =
                            'vercel-dev-project-id'
                        env.FRONTEND_ENV_CREDENTIAL =
                            'frontend-dev'
                    } else {
                        error(
                            "배포 대상이 아닌 브랜치입니다: " +
                            env.BRANCH_NAME
                        )
                    }
                }

                sh '''
                    set -eu

                    echo "Deploy environment: $DEPLOY_ENV"
                    echo "Backend image: $BACKEND_IMAGE"
                    echo "Backend container: $BACKEND_CONTAINER"
                    echo "Backend network: $BACKEND_NETWORK"
                    echo "Backend alias: $BACKEND_ALIAS"
                '''
            }
        }

        stage('Check Backend Requirements') {
            // 전환 중: DEPLOY_LEGACY_BACKEND(기본 false)로 전체를 잠갔다.
            // `deploy/**`·`Jenkinsfile` 트리거도 뺐다 — Node 스택 파일을 고쳤을 때
            // 이 잡이 구 호스트에 backend-java를 재배포하려 들면 안 된다.
            when {
                allOf {
                    expression { params.DEPLOY_LEGACY_BACKEND }
                    anyOf {
                        expression { params.FORCE_DEPLOY_ALL }
                        changeset 'backend-java/**'
                    }
                }
            }

            steps {
                sh '''
                    set -eu

                    test -f "$BACKEND_ENV_FILE" || {
                        echo "환경 파일이 없습니다:"
                        echo "$BACKEND_ENV_FILE"
                        exit 1
                    }

                    docker network inspect \
                        "$BACKEND_NETWORK" > /dev/null || {
                        echo "백엔드 네트워크가 없습니다:"
                        echo "$BACKEND_NETWORK"
                        exit 1
                    }

                    docker network inspect \
                        app-network > /dev/null || {
                        echo "app-network가 없습니다."
                        exit 1
                    }
                '''
            }
        }

        stage('Build Backend JAR') {
            // 전환 중: DEPLOY_LEGACY_BACKEND(기본 false)로 전체를 잠갔다.
            // `deploy/**`·`Jenkinsfile` 트리거도 뺐다 — Node 스택 파일을 고쳤을 때
            // 이 잡이 구 호스트에 backend-java를 재배포하려 들면 안 된다.
            when {
                allOf {
                    expression { params.DEPLOY_LEGACY_BACKEND }
                    anyOf {
                        expression { params.FORCE_DEPLOY_ALL }
                        changeset 'backend-java/**'
                    }
                }
            }

            steps {
                dir('backend-java') {
                    sh '''
                        set -eu

                        chmod +x gradlew

                        ./gradlew \
                            clean \
                            bootJar \
                            -x test \
                            --no-daemon

                        JAR_FILE=$(
                            find build/libs \
                                -maxdepth 1 \
                                -type f \
                                -name "*.jar" \
                                ! -name "*-plain.jar" \
                                -print \
                                -quit
                        )

                        if [ -z "$JAR_FILE" ]; then
                            echo "실행 가능한 JAR가 없습니다."
                            exit 1
                        fi

                        cp "$JAR_FILE" build/app.jar
                        ls -lh build/app.jar
                    '''
                }
            }
        }

        stage('Build Backend Image') {
            // 전환 중: DEPLOY_LEGACY_BACKEND(기본 false)로 전체를 잠갔다.
            // `deploy/**`·`Jenkinsfile` 트리거도 뺐다 — Node 스택 파일을 고쳤을 때
            // 이 잡이 구 호스트에 backend-java를 재배포하려 들면 안 된다.
            when {
                allOf {
                    expression { params.DEPLOY_LEGACY_BACKEND }
                    anyOf {
                        expression { params.FORCE_DEPLOY_ALL }
                        changeset 'backend-java/**'
                    }
                }
            }

            steps {
                sh '''
                    set -eu

                    docker build \
                        --tag "$BACKEND_IMAGE" \
                        --label "yorr.environment=$DEPLOY_ENV" \
                        backend-java

                    docker image inspect \
                        "$BACKEND_IMAGE" > /dev/null
                '''
            }
        }

        stage('Deploy Backend') {
            // 전환 중: DEPLOY_LEGACY_BACKEND(기본 false)로 전체를 잠갔다.
            // `deploy/**`·`Jenkinsfile` 트리거도 뺐다 — Node 스택 파일을 고쳤을 때
            // 이 잡이 구 호스트에 backend-java를 재배포하려 들면 안 된다.
            when {
                allOf {
                    expression { params.DEPLOY_LEGACY_BACKEND }
                    anyOf {
                        expression { params.FORCE_DEPLOY_ALL }
                        changeset 'backend-java/**'
                    }
                }
            }

            steps {
                sh '''
                    set -eu

                    export BACKEND_IMAGE
                    export BACKEND_CONTAINER
                    export BACKEND_ENV_FILE
                    export BACKEND_NETWORK
                    export BACKEND_ALIAS

                    docker compose \
                        --project-name "$COMPOSE_PROJECT" \
                        --file deploy/compose.yaml \
                        config --quiet

                    docker compose \
                        --project-name "$COMPOSE_PROJECT" \
                        --file deploy/compose.yaml \
                        up \
                        --detach \
                        --force-recreate \
                        --no-deps \
                        backend
                '''
            }
        }

        stage('Verify Backend') {
            // 전환 중: DEPLOY_LEGACY_BACKEND(기본 false)로 전체를 잠갔다.
            // `deploy/**`·`Jenkinsfile` 트리거도 뺐다 — Node 스택 파일을 고쳤을 때
            // 이 잡이 구 호스트에 backend-java를 재배포하려 들면 안 된다.
            when {
                allOf {
                    expression { params.DEPLOY_LEGACY_BACKEND }
                    anyOf {
                        expression { params.FORCE_DEPLOY_ALL }
                        changeset 'backend-java/**'
                    }
                }
            }

            steps {
                sh '''
                    set -eu

                    sleep 15

                    RUNNING=$(
                        docker inspect \
                            --format='{{.State.Running}}' \
                            "$BACKEND_CONTAINER"
                    )

                    if [ "$RUNNING" != "true" ]; then
                        echo "백엔드 실행에 실패했습니다."

                        docker logs \
                            --tail 200 \
                            "$BACKEND_CONTAINER" || true

                        exit 1
                    fi

                    echo "백엔드 컨테이너 실행 확인:"
                    docker ps \
                        --filter "name=$BACKEND_CONTAINER"

                    echo "연결된 네트워크:"
                    docker inspect \
                        --format='{{json .NetworkSettings.Networks}}' \
                        "$BACKEND_CONTAINER"

                    docker logs \
                        --tail 100 \
                        "$BACKEND_CONTAINER"
                '''
            }
        }

        stage('Validate Frontend') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'frontend/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                dir('frontend') {
                    sh '''
                        set -eu

                        npm ci
                        npm run check -- --line-ending=lf
                        npm run typecheck
                        npm test
                        npm run build
                    '''
                }
            }

            post {
                always {
                    junit(
                        testResults:
                            'frontend/**/test-results/**/*.xml',
                        allowEmptyResults: true
                    )

                    archiveArtifacts(
                        artifacts:
                            'frontend/playwright-report/**/*',
                        allowEmptyArchive: true
                    )
                }
            }
        }

        stage('Deploy Frontend to Vercel') {
            when {
                anyOf {
                    expression {
                        currentBuild.number == 1 ||
                        params.FORCE_DEPLOY_ALL
                    }
                    changeset 'frontend/**'
                    changeset 'Jenkinsfile'
                }
            }

            steps {
                script {
                    withCredentials([
                        file(
                            credentialsId:
                                env.FRONTEND_ENV_CREDENTIAL,
                            variable: 'FRONTEND_ENV_FILE'
                        ),
                        string(
                            credentialsId: 'vercel-token',
                            variable: 'VERCEL_TOKEN'
                        ),
                        string(
                            credentialsId: 'vercel-org-id',
                            variable: 'VERCEL_ORG_ID'
                        ),
                        string(
                            credentialsId:
                                env.VERCEL_PROJECT_CREDENTIAL,
                            variable: 'VERCEL_PROJECT_ID'
                        )
                    ]) {
                        dir('frontend') {
                            sh '''
                                set +x
                                set -eu

                                test -f "$FRONTEND_ENV_FILE" || {
                                    echo "Frontend environment file is missing"
                                    exit 1
                                }

                                set -a
                                . "$FRONTEND_ENV_FILE"
                                set +a

                                test -n "${VITE_API_BASE_URL:-}" || {
                                    echo "VITE_API_BASE_URL is missing"
                                    exit 1
                                }

                                test -n "${VITE_WS_URL:-}" || {
                                    echo "VITE_WS_URL is missing"
                                    exit 1
                                }

                                echo "Frontend environment variables loaded"

                                npx --yes vercel@latest pull \
                                    --yes \
                                    --environment=production \
                                    --token="$VERCEL_TOKEN"

                                npx --yes vercel@latest build \
                                    --prod \
                                    --token="$VERCEL_TOKEN"

                                npx --yes vercel@latest deploy \
                                    --prebuilt \
                                    --prod \
                                    --token="$VERCEL_TOKEN" \
                                    > vercel-deployment-url.txt

                                echo "Vercel deployment URL:"
                                cat vercel-deployment-url.txt
                            '''
                        }
                    }
                }
            }

            post {
                success {
                    archiveArtifacts(
                        artifacts:
                            'frontend/vercel-deployment-url.txt',
                        fingerprint: true
                    )
                }
            }
        }
    }

    post {
        failure {
            script {
                if (env.BACKEND_CONTAINER?.trim()) {
                    sh '''
                        echo "Backend logs:"

                        docker logs \
                            --tail 200 \
                            "$BACKEND_CONTAINER" \
                            2>/dev/null || true
                    '''
                }
            }
        }

        success {
            echo "${env.BRANCH_NAME} Pipeline succeeded."
        }

        cleanup {
            deleteDir()
        }
    }
}